/**
 * Alexa Reminders API service
 *
 * Reminders are created using the skill's session apiAccessToken.
 * This token is valid only during an active skill session, so reminders
 * must be created while the user is in a conversation with the skill.
 *
 * Docs: https://developer.amazon.com/docs/smapi/alexa-reminders-api-reference.html
 */

const https = require('https');
const config = require('../config');
const { eventIdentityKey } = require('./eventIdentity');
const {
  buildReminderText,
  getReminderMinutesBefore,
} = require('./reminderPresentation');
const REMINDERS_API_RETRY_DELAY_MS = 750;
const REMINDERS_API_MAX_RETRIES = 1;

// Format a Date as YYYY-MM-DDTHH:MM:SS in a specific timezone
// This matches exactly what Alexa stores and returns for scheduledTime
function formatInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const p = {};
  parts.forEach(({ type, value }) => (p[type] = value));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

function buildReminderPayload(eventSummary, scheduledTime, timezone, minutesBefore) {
  return {
    requestTime: formatInTimezone(new Date(), timezone),
    trigger: {
      type: 'SCHEDULED_ABSOLUTE',
      scheduledTime: scheduledTime, // already formatted in local timezone
      timeZoneId: timezone,
    },
    alertInfo: {
      spokenInfo: {
        content: [
          {
            locale: 'en-US',
            text: buildReminderText(eventSummary, minutesBefore),
          },
        ],
      },
    },
    pushNotification: {
      status: 'ENABLED',
    },
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildRemindersApiError(statusCode, data) {
  const err = new Error(`Reminders API error ${statusCode}: ${data}`);
  err.statusCode = statusCode;
  err.responseBody = data;
  err.retryable = statusCode >= 500;
  return err;
}

function alexaRequestOnce(method, path, apiAccessToken, apiEndpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${apiEndpoint}${path}`);
    const bodyStr = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method,
      headers: {
        Authorization: `Bearer ${apiAccessToken}`,
        ...(bodyStr && {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        }),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 204 || res.statusCode === 200 || res.statusCode === 201) {
          resolve(data ? JSON.parse(data) : null);
        } else {
          reject(buildRemindersApiError(res.statusCode, data));
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function alexaRequest(method, path, apiAccessToken, apiEndpoint, body, attempt = 0) {
  try {
    return await alexaRequestOnce(method, path, apiAccessToken, apiEndpoint, body);
  } catch (err) {
    if (err.retryable && attempt < REMINDERS_API_MAX_RETRIES) {
      console.warn(`Reminders API retry ${attempt + 1} for ${method} ${path} after ${err.statusCode}`);
      await sleep(REMINDERS_API_RETRY_DELAY_MS);
      return alexaRequest(method, path, apiAccessToken, apiEndpoint, body, attempt + 1);
    }
    throw err;
  }
}

function getExistingReminders(apiAccessToken, apiEndpoint) {
  return alexaRequest('GET', '/v1/alerts/reminders', apiAccessToken, apiEndpoint)
    .then(data => (data && data.alerts) ? data.alerts : []);
}

function deleteReminder(apiAccessToken, apiEndpoint, alertToken) {
  return alexaRequest('DELETE', `/v1/alerts/reminders/${alertToken}`, apiAccessToken, apiEndpoint);
}

function updateReminder(apiAccessToken, apiEndpoint, alertToken, payload) {
  return alexaRequest('PUT', `/v1/alerts/reminders/${alertToken}`, apiAccessToken, apiEndpoint, payload);
}

/**
 * Deletes ALL reminders (future + past) created by this skill.
 * Used by DisableIntent.
 */
async function deleteAllReminders(apiAccessToken, apiEndpoint) {
  const existing = await getExistingReminders(apiAccessToken, apiEndpoint);
  for (const r of existing) {
    try {
      await deleteReminder(apiAccessToken, apiEndpoint, r.alertToken);
    } catch (err) {
      if (err.message.includes('ALERT_NOT_FOUND')) {
        console.warn(`Reminder already missing during deleteAllReminders: ...${r.alertToken.slice(-8)}`);
        continue;
      }
      throw err;
    }
  }
  return existing.length;
}

/**
 * Syncs reminders to match current calendar events.
 * Compares existing reminders to desired reminders and only adds/removes the diff.
 * Much faster than delete-all-then-recreate.
 * Returns { created, deleted, skipped, eventNames }
 */
async function createRemindersForEvents(
  apiAccessToken,
  apiEndpoint,
  events,
  minutesBefore = config.REMINDER_MINUTES_BEFORE,
  existingMappings = []
) {
  const now = new Date();
  let created = 0;
  let deleted = 0;
  let updated = 0;
  let covered = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];
  const eventNames = [];
  const mappingsToUpsert = [];
  const mappingsToDelete = [];

  const mappingsByEvent = new Map(
    existingMappings.map(mapping => [mapping.eventIdentityKey, mapping])
  );

  // Build the desired set keyed by Google event instance, not scheduled minute.
  const desired = new Map();
  const desiredReminderKeys = new Set();
  for (const event of events) {
    if (event.isAllDay) { skipped++; continue; }
    const eventMinutesBefore = getReminderMinutesBefore(event, minutesBefore);
    const reminderTime = new Date(event.startTime.getTime() - eventMinutesBefore * 60 * 1000);
    if (reminderTime <= now) { skipped++; continue; }
    const timezone = event.timezone || 'UTC';
    const localStr = formatInTimezone(reminderTime, timezone); // YYYY-MM-DDTHH:MM:SS in local tz
    const key = eventIdentityKey(event);
    const reminderText = buildReminderText(event.summary, eventMinutesBefore);
    const reminderKey = `${localStr}|${timezone}|${reminderText}`;
    if (desiredReminderKeys.has(reminderKey)) {
      skipped++;
      console.warn(`Skipped duplicate desired reminder for event="${event.summary}" scheduledTime=${localStr}`);
      continue;
    }
    desiredReminderKeys.add(reminderKey);

    desired.set(key, {
      event,
      summary: event.summary,
      timezone,
      scheduledTime: localStr,
      reminderTime,
      reminderText,
      minutesBefore: eventMinutesBefore,
    });
  }

  // Get existing future reminders
  const existing = await getExistingReminders(apiAccessToken, apiEndpoint);
  const futureExisting = existing.filter(r => isActiveReminder(r, now));
  console.log(`Reminder sync snapshot: desired=${desired.size}, existingFuture=${futureExisting.length}, mappings=${existingMappings.length}`);

  const existingByAlertToken = new Map(
    futureExisting.filter(r => r.alertToken).map(r => [r.alertToken, r])
  );
  const existingByMinute = new Map();
  for (const r of futureExisting) {
    if (!r.alertToken || !r.trigger || !r.trigger.scheduledTime) continue;
    const key = r.trigger.scheduledTime.slice(0, 16);
    if (!existingByMinute.has(key)) existingByMinute.set(key, []);
    existingByMinute.get(key).push(r);
  }

  const usedAlertTokens = new Set();

  for (const [key, desiredReminder] of desired) {
    const mappedReminder = mappingsByEvent.get(key);
    const existingMappedReminder = mappedReminder && existingByAlertToken.get(mappedReminder.alertToken);

    if (existingMappedReminder) {
      const payload = buildReminderPayload(
        desiredReminder.summary,
        desiredReminder.scheduledTime,
        desiredReminder.timezone,
        desiredReminder.minutesBefore
      );

      if (reminderNeedsUpdate(existingMappedReminder, payload)) {
        try {
          await updateReminder(apiAccessToken, apiEndpoint, mappedReminder.alertToken, payload);
          updated++;
        } catch (err) {
          failed++;
          errors.push(err.message);
          console.error(`Reminder update failed for event="${desiredReminder.summary}":`, err.message);
        }
      }

      covered++;
      usedAlertTokens.add(mappedReminder.alertToken);
      mappingsToUpsert.push(buildReminderMapping(key, mappedReminder.alertToken, desiredReminder, desiredReminder.minutesBefore));
      continue;
    }

    const legacyReminder = takeLegacyReminder(existingByMinute, desiredReminder, usedAlertTokens);
    if (legacyReminder) {
      covered++;
      usedAlertTokens.add(legacyReminder.alertToken);
      mappingsToUpsert.push(buildReminderMapping(key, legacyReminder.alertToken, desiredReminder, desiredReminder.minutesBefore));
      continue;
    }

    const payload = buildReminderPayload(
      desiredReminder.summary,
      desiredReminder.scheduledTime,
      desiredReminder.timezone,
      desiredReminder.minutesBefore
    );
    try {
      const createdReminder = await alexaRequest('POST', '/v1/alerts/reminders', apiAccessToken, apiEndpoint, payload);
      if (createdReminder && createdReminder.alertToken) {
        created++;
        eventNames.push(desiredReminder.summary.length > 40 ? desiredReminder.summary.slice(0, 39) + '…' : desiredReminder.summary);
        usedAlertTokens.add(createdReminder.alertToken);
        mappingsToUpsert.push(buildReminderMapping(key, createdReminder.alertToken, desiredReminder, desiredReminder.minutesBefore));
      } else {
        failed++;
        const message = `Reminder created without alertToken for event="${desiredReminder.summary}"`;
        errors.push(message);
        console.error(message);
      }
    } catch (err) {
      const recoveredReminder = await findExistingReminderForDesired(
        apiAccessToken,
        apiEndpoint,
        desiredReminder,
        now,
        usedAlertTokens
      );

      if (recoveredReminder) {
        covered++;
        usedAlertTokens.add(recoveredReminder.alertToken);
        mappingsToUpsert.push(buildReminderMapping(key, recoveredReminder.alertToken, desiredReminder, desiredReminder.minutesBefore));
        console.warn(`Recovered reminder mapping after create error for event="${desiredReminder.summary}"`);
      } else {
        failed++;
        errors.push(err.message);
        console.error(`Reminder create failed for event="${desiredReminder.summary}":`, err.message);
      }
    }
  }

  for (const r of futureExisting) {
    if (r.alertToken && !usedAlertTokens.has(r.alertToken)) {
      try {
        await deleteReminder(apiAccessToken, apiEndpoint, r.alertToken);
        deleted++;
      } catch (err) {
        failed++;
        errors.push(err.message);
        console.error(`Reminder delete failed for alertToken=...${r.alertToken.slice(-8)}:`, err.message);
      }
    }
  }

  const duplicateCleanup = await cleanupExactDuplicateReminders(
    apiAccessToken,
    apiEndpoint,
    desired,
    now,
    usedAlertTokens
  );
  deleted += duplicateCleanup.deleted;
  failed += duplicateCleanup.failed;
  errors.push(...duplicateCleanup.errors);
  for (const mapping of duplicateCleanup.mappingsToUpsert) {
    mappingsToUpsert.push(mapping);
  }

  for (const mapping of existingMappings) {
    if (!desired.has(mapping.eventIdentityKey)) {
      mappingsToDelete.push(mapping.eventIdentityKey);
    }
  }

  return { created, deleted, updated, covered, skipped, failed, errors, eventNames, mappingsToUpsert, mappingsToDelete };
}

function reminderNeedsUpdate(existingReminder, payload) {
  const existingText = extractReminderText(existingReminder);
  const existingMinute = existingReminder.trigger.scheduledTime &&
    existingReminder.trigger.scheduledTime.slice(0, 16);
  const desiredMinute = payload.trigger.scheduledTime.slice(0, 16);

  return (
    existingMinute !== desiredMinute ||
    normalizeReminderText(existingText) !== normalizeReminderText(payload.alertInfo.spokenInfo.content[0].text)
  );
}

function takeLegacyReminder(existingByMinute, desiredReminder, usedAlertTokens) {
  const key = desiredReminder.scheduledTime.slice(0, 16);
  const reminders = existingByMinute.get(key) || [];
  const exactIndex = reminders.findIndex(reminder =>
    !usedAlertTokens.has(reminder.alertToken) &&
    extractReminderText(reminder) === desiredReminder.reminderText
  );

  if (exactIndex >= 0) {
    return reminders.splice(exactIndex, 1)[0];
  }

  const fallbackIndex = reminders.findIndex(reminder => !usedAlertTokens.has(reminder.alertToken));
  if (fallbackIndex >= 0) {
    return reminders.splice(fallbackIndex, 1)[0];
  }

  return null;
}

async function cleanupExactDuplicateReminders(
  apiAccessToken,
  apiEndpoint,
  desired,
  now,
  usedAlertTokens
) {
  let deleted = 0;
  let failed = 0;
  const errors = [];
  const mappingsToUpsert = [];

  let existing;
  try {
    existing = await getExistingReminders(apiAccessToken, apiEndpoint);
  } catch (err) {
    console.error('Reminder duplicate cleanup lookup failed:', err.message);
    return { deleted, failed: failed + 1, errors: [err.message], mappingsToUpsert };
  }

  const futureExisting = existing.filter(reminder =>
    reminder.alertToken &&
    isActiveReminder(reminder, now)
  );

  for (const [key, desiredReminder] of desired) {
    const matches = futureExisting.filter(reminder =>
      reminder.trigger.scheduledTime.slice(0, 16) === desiredReminder.scheduledTime.slice(0, 16) &&
      extractReminderText(reminder) === desiredReminder.reminderText
    );

    if (matches.length <= 1) continue;

    const kept = matches.find(reminder => usedAlertTokens.has(reminder.alertToken)) || matches[0];
    if (!usedAlertTokens.has(kept.alertToken)) {
      usedAlertTokens.add(kept.alertToken);
      mappingsToUpsert.push(buildReminderMapping(key, kept.alertToken, desiredReminder, desiredReminder.minutesBefore));
    }

    for (const duplicate of matches) {
      if (duplicate.alertToken === kept.alertToken) continue;

      try {
        await deleteReminder(apiAccessToken, apiEndpoint, duplicate.alertToken);
        deleted++;
        console.warn(`Deleted duplicate reminder for event="${desiredReminder.summary}" alertToken=...${duplicate.alertToken.slice(-8)}`);
      } catch (err) {
        failed++;
        errors.push(err.message);
        console.error(`Duplicate reminder delete failed for event="${desiredReminder.summary}" alertToken=...${duplicate.alertToken.slice(-8)}:`, err.message);
      }
    }
  }

  return { deleted, failed, errors, mappingsToUpsert };
}

async function findExistingReminderForDesired(
  apiAccessToken,
  apiEndpoint,
  desiredReminder,
  now,
  usedAlertTokens
) {
  try {
    const existing = await getExistingReminders(apiAccessToken, apiEndpoint);
    const matching = existing.find(reminder =>
      reminder.alertToken &&
      !usedAlertTokens.has(reminder.alertToken) &&
      reminder.trigger &&
      reminder.trigger.scheduledTime &&
      isActiveReminder(reminder, now) &&
      reminder.trigger.scheduledTime.slice(0, 16) === desiredReminder.scheduledTime.slice(0, 16) &&
      extractReminderText(reminder) === desiredReminder.reminderText
    );

    return matching || null;
  } catch (recoveryErr) {
    console.error(`Reminder create recovery lookup failed for event="${desiredReminder.summary}":`, recoveryErr.message);
    return null;
  }
}

function extractReminderText(reminder) {
  return reminder.alertInfo &&
    reminder.alertInfo.spokenInfo &&
    reminder.alertInfo.spokenInfo.content &&
    reminder.alertInfo.spokenInfo.content[0] &&
    reminder.alertInfo.spokenInfo.content[0].text;
}

function normalizeReminderText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function isActiveReminder(reminder, now) {
  if (!reminder.trigger || !reminder.trigger.scheduledTime) return false;
  if (reminder.status) return reminder.status !== 'COMPLETED';
  return new Date(reminder.trigger.scheduledTime) > now;
}

function buildReminderMapping(key, alertToken, desiredReminder, minutesBefore) {
  return {
    eventIdentityKey: key,
    calendarId: desiredReminder.event.calendarId,
    eventId: desiredReminder.event.id,
    alertToken,
    summary: desiredReminder.summary,
    eventStartTime: desiredReminder.event.startTime.toISOString(),
    reminderTime: desiredReminder.reminderTime.toISOString(),
    reminderScheduledTime: desiredReminder.scheduledTime,
    reminderMinutes: minutesBefore,
    timezone: desiredReminder.timezone,
  };
}

module.exports = { createRemindersForEvents, deleteAllReminders };
