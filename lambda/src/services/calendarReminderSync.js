const { getUpcomingEvents } = require('./googleCalendar');
const { createRemindersForEvents } = require('./reminders');
const {
  finishSync,
  deleteReminderMappings,
  getUserSettings,
  listReminderMappings,
  tryBeginSync,
  upsertReminderMappings,
  upsertUserSync,
  enableUser,
} = require('./dynamodb');
const { shouldAnnounceEvent } = require('./eventFilters');
const { linkRefreshToken } = require('./tokenLink');
const config = require('../config');

function classifyReminderError(err) {
  if (err.message.includes('401')) return 'reminders_permission_required';
  if (err.message.includes('DEVICE_NOT_REACHABLE')) return 'device_not_reachable';
  if (err.retryable || err.message.includes('Reminders API error 5')) return 'reminders_temporarily_unavailable';
  return 'reminders_error';
}

async function runCalendarReminderSync({
  userId,
  deviceId,
  accessToken,
  apiAccessToken,
  apiEndpoint,
  quietSync = false,
  calendarIdsOverride,
}) {
  if (!accessToken) {
    return { ok: false, code: 'google_link_required' };
  }

  let userSettings = {};
  try {
    userSettings = await getUserSettings(userId);
  } catch (err) {
    console.error('DynamoDB settings read failed:', err.message);
  }

  let syncLease;
  try {
    syncLease = await tryBeginSync(userId, {
      cooldownSeconds: quietSync ? config.QUIET_SYNC_COOLDOWN_SECONDS : config.SYNC_COOLDOWN_SECONDS,
      inFlightSeconds: config.SYNC_IN_FLIGHT_SECONDS,
    });
  } catch (err) {
    console.error('Sync throttle check failed:', err.message);
    return { ok: false, code: 'sync_start_failed' };
  }

  if (!syncLease.started) {
    console.log(`Sync skipped: ${syncLease.reason} userId=${userId}`);
    return { ok: true, code: 'skipped', reason: syncLease.reason };
  }

  if (!userSettings.googleRefreshToken) {
    try {
      await linkRefreshToken(userId, accessToken);
    } catch (err) {
      console.error('Token link failed during sync:', err.message);
    }
  }

  const calendarIds = calendarIdsOverride || userSettings.calendarIds || ['primary'];
  const minutesBefore = userSettings.reminderMinutes || config.REMINDER_MINUTES_BEFORE;

  let events;
  try {
    events = await getUpcomingEvents(accessToken, config.SYNC_LOOKAHEAD_HOURS, calendarIds);
  } catch (err) {
    console.error('Google Calendar fetch error:', err);
    await finishSync(userId, { quietSync, failed: true }).catch(releaseErr => {
      console.error('Sync lock release failed after calendar fetch error:', releaseErr.message);
    });
    return { ok: false, code: 'calendar_read_error' };
  }

  events = events.filter(event => shouldAnnounceEvent(event, userSettings));

  let result;
  try {
    const existingMappings = await listReminderMappings(userId);
    result = await createRemindersForEvents(
      apiAccessToken,
      apiEndpoint,
      events,
      minutesBefore,
      existingMappings
    );

    if (result.mappingsToUpsert.length > 0) {
      await upsertReminderMappings(userId, result.mappingsToUpsert);
    }
    if (result.mappingsToDelete.length > 0) {
      await deleteReminderMappings(userId, result.mappingsToDelete);
    }
  } catch (err) {
    console.error('Reminders API error:', err);
    await finishSync(userId, { quietSync, failed: true }).catch(releaseErr => {
      console.error('Sync lock release failed after reminders error:', releaseErr.message);
    });
    return { ok: false, code: classifyReminderError(err), error: err };
  }

  const syncThrough = new Date(Date.now() + config.SYNC_LOOKAHEAD_HOURS * 60 * 60 * 1000);
  upsertUserSync(userId, deviceId, calendarIds, events, minutesBefore, syncThrough)
    .then(() => enableUser(userId))
    .catch(err => console.error('DynamoDB sync write failed:', err.message));

  await finishSync(userId, { quietSync }).catch(err => {
    console.error('Sync lock release failed after success:', err.message);
  });

  return {
    ok: true,
    code: 'success',
    result,
    events,
    calendarIds,
    minutesBefore,
  };
}

module.exports = { runCalendarReminderSync };
