/**
 * Google Calendar sync Lambda.
 *
 * Modes:
 * - API Gateway webhook: receives Google Calendar push notifications.
 * - Direct invoke: { "action": "setupUser", "userId": "..." } creates watches and full-syncs.
 * - Scheduled invoke: renews/syncs active users conservatively.
 */

const {
  deleteDueEventPointer,
  getCalendarState,
  getReminderMapping,
  getUserSettings,
  getWatch,
  listUserSettings,
  markNeedsSpokenReminderSync,
  markReminderMappingDeleted,
  reserveSyncNudgeNotification,
  saveCalendarState,
  saveWatch,
  updateReminderMappingAfterBackgroundSync,
  upsertDueEvent,
  verifyWatchToken,
} = require('./services/dynamodb');
const {
  fullSyncEvents,
  incrementalSyncEvents,
  refreshAccessToken,
  watchEvents,
} = require('./services/googleCalendar');
const { eventIdentityKey } = require('./services/eventIdentity');
const { normalizeEvent, shouldAnnounceEvent } = require('./services/eventFilters');
const { getReminderMinutesBefore } = require('./services/reminderPresentation');
const { sendSyncNudgeNotification } = require('./services/proactiveEvents');
const { sendReminderDelete, sendReminderUpdate } = require('./services/skillMessaging');

exports.handler = async (event = {}) => {
  if (isGoogleWebhook(event)) {
    return handleWebhook(event);
  }

  if (event.action === 'setupUser' && event.userId) {
    await setupUser(event.userId);
    return { ok: true };
  }

  await reconcileUsers();
  return { ok: true };
};

async function handleWebhook(event) {
  const headers = normalizeHeaders(event.headers || {});
  const channelId = headers['x-goog-channel-id'];
  const channelToken = headers['x-goog-channel-token'];
  const resourceId = headers['x-goog-resource-id'];
  const resourceState = headers['x-goog-resource-state'];

  if (!channelId) return response(400, 'missing channel id');

  const watch = await getWatch(channelId);
  if (!watch) return response(404, 'unknown channel');
  if (watch.resourceId !== resourceId) return response(403, 'resource mismatch');
  if (!verifyWatchToken(watch, channelToken)) return response(403, 'token mismatch');

  if (resourceState === 'not_exists') {
    console.warn(`Calendar resource disappeared for userId=...${watch.userId.slice(-8)} calendar=${watch.calendarId}`);
    return response(204, '');
  }

  await syncCalendar(watch.userId, watch.calendarId, { incremental: true });
  return response(204, '');
}

async function setupUser(userId) {
  const settings = await getUserSettings(userId);
  if (!settings || !settings.enabled || !settings.googleRefreshToken) return;

  const calendarIds = settings.calendarIds && settings.calendarIds.length
    ? settings.calendarIds
    : ['primary'];

  const accessToken = await refreshAccessToken(settings.googleRefreshToken);
  const now = new Date();
  const renewalHours = parseInt(process.env.WATCH_RENEWAL_HOURS || '24', 10);

  for (const calendarId of calendarIds) {
    await syncCalendarWithAccessToken(settings, accessToken, calendarId, { incremental: false });
    const state = await getCalendarState(userId, calendarId);
    if (shouldRenewWatch(state, now, renewalHours)) {
      const watch = await watchEvents(accessToken, calendarId);
      await saveWatch(userId, calendarId, watch);
    }
  }
}

async function reconcileUsers() {
  const users = await listUserSettings();
  const now = new Date();
  const renewalHours = parseInt(process.env.WATCH_RENEWAL_HOURS || '24', 10);

  for (const settings of users) {
    if (!settings.googleRefreshToken) continue;
    const calendarIds = settings.calendarIds && settings.calendarIds.length
      ? settings.calendarIds
      : ['primary'];

    let accessToken;
    try {
      accessToken = await refreshAccessToken(settings.googleRefreshToken);
    } catch (err) {
      console.error(`Google refresh failed for userId=...${settings.userId.slice(-8)}:`, err.message);
      continue;
    }

    for (const calendarId of calendarIds) {
      try {
        const state = await getCalendarState(settings.userId, calendarId);
        await syncCalendarWithAccessToken(settings, accessToken, calendarId, { incremental: Boolean(state && state.syncToken) });

        if (shouldRenewWatch(state, now, renewalHours)) {
          const watch = await watchEvents(accessToken, calendarId);
          await saveWatch(settings.userId, calendarId, watch);
        }
      } catch (err) {
        console.error(`Reconcile failed for userId=...${settings.userId.slice(-8)} calendar=${calendarId}:`, err.message);
      }
    }
  }
}

async function syncCalendar(userId, calendarId, options) {
  const settings = await getUserSettings(userId);
  if (!settings || !settings.enabled || !settings.googleRefreshToken) return;

  const accessToken = await refreshAccessToken(settings.googleRefreshToken);
  await syncCalendarWithAccessToken(settings, accessToken, calendarId, options);
}

async function syncCalendarWithAccessToken(settings, accessToken, calendarId, options) {
  const state = await getCalendarState(settings.userId, calendarId);
  const hoursAhead = parseInt(process.env.SYNC_LOOKAHEAD_HOURS || '48', 10);
  let unmappedEventForNudge = null;

  let result;
  if (options.incremental && state && state.syncToken) {
    try {
      result = await incrementalSyncEvents(accessToken, calendarId, state.syncToken);
    } catch (err) {
      if (err.statusCode !== 410) throw err;
      result = await fullSyncEvents(accessToken, calendarId, hoursAhead);
    }
  } else {
    result = await fullSyncEvents(accessToken, calendarId, hoursAhead);
  }

  for (const rawEvent of result.items) {
    const event = normalizeEvent(rawEvent, calendarId, result.calendarDefaultReminders || []);
    if (!event || !shouldAnnounceEvent(rawEvent)) {
      const mapping = rawEvent.id
        ? await getReminderMapping(settings.userId, `${calendarId}:${rawEvent.id}`)
        : null;
      if (mapping && mapping.status !== 'deleted') {
        try {
          await sendReminderDelete(settings.userId, mapping);
          await markReminderMappingDeleted(settings.userId, mapping);
          console.log(`Queued spoken reminder delete for userId=...${settings.userId.slice(-8)} event="${mapping.summary}"`);
        } catch (err) {
          console.error(`Spoken reminder delete failed for userId=...${settings.userId.slice(-8)} event="${mapping.summary}":`, err.message);
        }
      }
      if (rawEvent.id) await deleteDueEventPointer(settings.userId, calendarId, rawEvent.id);
      continue;
    }

    const mapping = await getReminderMapping(settings.userId, eventIdentityKey(event));
    if (mapping && mapping.status !== 'deleted') {
      const reminderMinutes = getReminderMinutesBefore(
        event,
        settings.reminderMinutes || mapping.reminderMinutes || 10
      );
      if (reminderMappingNeedsUpdate(mapping, event, reminderMinutes)) {
        try {
          await sendReminderUpdate(settings.userId, mapping, event, reminderMinutes);
          await updateReminderMappingAfterBackgroundSync(settings.userId, mapping, event, reminderMinutes);
          console.log(`Queued spoken reminder update for userId=...${settings.userId.slice(-8)} event="${event.summary}"`);
        } catch (err) {
          console.error(`Spoken reminder update failed for userId=...${settings.userId.slice(-8)} event="${event.summary}":`, err.message);
        }
      }
    } else {
      await markNeedsSpokenReminderSync(settings.userId, event);
      if (!unmappedEventForNudge) unmappedEventForNudge = event;
    }

    await upsertDueEvent(settings, event);
  }

  if (unmappedEventForNudge) {
    await maybeSendSyncNudge(settings, unmappedEventForNudge);
  }

  if (result.nextSyncToken) {
    await saveCalendarState(settings.userId, calendarId, { syncToken: result.nextSyncToken });
  }
}

async function maybeSendSyncNudge(settings, event) {
  return;
  if (settings.syncNudgeNotificationsEnabled === false) return;
  if (!settings.lastSpokenReminderSyncThrough) return;

  const intervalHours = parseInt(process.env.SYNC_NUDGE_INTERVAL_HOURS || '24', 10);
  let reserved = false;
  try {
    reserved = await reserveSyncNudgeNotification(settings.userId, intervalHours);
  } catch (err) {
    console.error(`Sync nudge rate-limit check failed for userId=...${settings.userId.slice(-8)}:`, err.message);
    return;
  }

  if (!reserved) return;

  try {
    await sendSyncNudgeNotification(settings.userId, event.summary);
    console.log(`Sent sync nudge notification for userId=...${settings.userId.slice(-8)} event="${event.summary}"`);
  } catch (err) {
    console.error(`Sync nudge notification failed for userId=...${settings.userId.slice(-8)} event="${event.summary}":`, err.message);
  }
}

function shouldRenewWatch(state, now, renewalHours) {
  if (!state || !state.watchExpiration) return true;
  const expiration = new Date(state.watchExpiration);
  if (Number.isNaN(expiration.getTime())) return true;
  return expiration - now < renewalHours * 60 * 60 * 1000;
}

function reminderMappingNeedsUpdate(mapping, event, reminderMinutes) {
  const reminderTime = new Date(event.startTime.getTime() - reminderMinutes * 60 * 1000).toISOString();
  return (
    mapping.summary !== event.summary ||
    mapping.eventStartTime !== event.startTime.toISOString() ||
    mapping.reminderTime !== reminderTime ||
    mapping.reminderMinutes !== reminderMinutes ||
    mapping.timezone !== (event.timezone || mapping.timezone || 'UTC')
  );
}

function isGoogleWebhook(event) {
  const headers = normalizeHeaders(event.headers || {});
  return Boolean(headers['x-goog-channel-id']);
}

function normalizeHeaders(headers) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function response(statusCode, body) {
  return { statusCode, body };
}
