/**
 * DynamoDB service — skill Lambda side
 *
 * Writes user identity and preferences so the poller Lambda can read Google
 * Calendar in the background and send Proactive Events when events are imminent.
 *
 * Uses @aws-sdk/lib-dynamodb (DynamoDBDocumentClient) which handles
 * marshalling/unmarshalling automatically — no {S: "value"} syntax needed.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const config = require('../config');
const { reminderMappingSortKey } = require('./eventIdentity');
const { getReminderMinutesBefore } = require('./reminderPresentation');

const client = new DynamoDBClient({ region: config.AWS_REGION });
const ddb = DynamoDBDocumentClient.from(client);

function settingsKey(userId) {
  return { pk: `USER#${userId}`, sk: 'SETTINGS' };
}

/**
 * Upserts userId + deviceId on every skill launch.
 * Uses UpdateItem so it never overwrites calendarIds or upcomingEvents.
 * Fire-and-forget — caller should .catch() and log, not await.
 */
async function upsertUserIdentity(userId, deviceId) {
  await ddb.send(new UpdateCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    Key: settingsKey(userId),
    UpdateExpression: [
      'SET userId = :u',
      'deviceId = :d',
      'enabled = if_not_exists(enabled, :t)',
      'reminderMinutes = if_not_exists(reminderMinutes, :m)',
      'calendarIds = if_not_exists(calendarIds, :c)',
      'updatedAt = :now',
    ].join(', '),
    ExpressionAttributeValues: {
      ':u': userId,
      ':d': deviceId,
      ':t': true,
      ':m': config.REMINDER_MINUTES_BEFORE,
      ':c': ['primary'],
      ':now': new Date().toISOString(),
    },
  }));
}

async function getUserSettings(userId) {
  const result = await ddb.send(new GetCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    Key: settingsKey(userId),
  }));

  return result.Item || {};
}

async function tryBeginSync(userId, { cooldownSeconds, inFlightSeconds }) {
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - cooldownSeconds * 1000).toISOString();
  const inFlightUntilIso = new Date(now.getTime() + inFlightSeconds * 1000).toISOString();

  try {
    await ddb.send(new UpdateCommand({
      TableName: config.DYNAMODB_TABLE_NAME,
      Key: settingsKey(userId),
      UpdateExpression: [
        'SET userId = :u',
        'lastSyncStartedAt = :now',
        'syncInFlightUntil = :inFlightUntil',
        'updatedAt = :now',
      ].join(', '),
      ConditionExpression: [
        '(attribute_not_exists(syncInFlightUntil) OR syncInFlightUntil < :now)',
        'AND',
        '(attribute_not_exists(lastSyncCompletedAt) OR lastSyncCompletedAt < :cutoff)',
      ].join(' '),
      ExpressionAttributeValues: {
        ':u': userId,
        ':now': nowIso,
        ':inFlightUntil': inFlightUntilIso,
        ':cutoff': cutoffIso,
      },
    }));

    return { started: true };
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') {
      throw err;
    }

    const settings = await getUserSettings(userId);
    const inFlight = settings.syncInFlightUntil && settings.syncInFlightUntil > nowIso;
    return {
      started: false,
      reason: inFlight ? 'in_flight' : 'cooldown',
      settings,
    };
  }
}

async function finishSync(userId, { quietSync = false, failed = false } = {}) {
  const nowIso = new Date().toISOString();
  const parts = ['SET userId = :u', 'updatedAt = :now'];
  const values = {
    ':u': userId,
    ':now': nowIso,
  };

  if (!failed) {
    parts.push('lastSyncCompletedAt = :now');
    if (quietSync) {
      parts.push('lastQuietSyncAt = :now');
    }
  }

  await ddb.send(new UpdateCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    Key: settingsKey(userId),
    UpdateExpression: `${parts.join(', ')} REMOVE syncInFlightUntil`,
    ExpressionAttributeValues: values,
  }));
}

/**
 * Writes the synced event list after a successful SyncCalendarIntent.
 * The poller now fetches Google Calendar live, but keeping this snapshot is
 * useful for debugging manual sync and future UI/status responses.
 *
 * @param {string}   userId
 * @param {string}   deviceId
 * @param {string[]} calendarIds
 * @param {Array}    events        - from googleCalendar.getUpcomingEvents()
 * @param {number}   minutesBefore - config.REMINDER_MINUTES_BEFORE
 */
async function upsertUserSync(userId, deviceId, calendarIds, events, minutesBefore, syncThrough) {
  const now = new Date();

  const upcomingEvents = events.map(event => {
    const eventMinutesBefore = getReminderMinutesBefore(event, minutesBefore);
    const reminderTime = new Date(event.startTime.getTime() - eventMinutesBefore * 60 * 1000);
    // reminderCreated = true if this event is future-timed and got a reminder
    const reminderCreated = !event.isAllDay && reminderTime > now;
    return {
      id: event.id,
      summary: event.summary,
      startTime: event.startTime.toISOString(),
      timezone: event.timezone || 'UTC',
      calendarId: event.calendarId,
      isAllDay: event.isAllDay,
      reminderCreated,
    };
  });

  await ddb.send(new UpdateCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    Key: settingsKey(userId),
    UpdateExpression: [
      'SET userId = :u',
      'deviceId = :d',
      'calendarIds = :c',
      'upcomingEvents = :e',
      'reminderMinutes = :m',
      'lastSynced = :t',
      'lastSpokenReminderSyncThrough = :through',
      'needsSpokenReminderSync = :f',
      'enabled = if_not_exists(enabled, :tr)',
    ].join(', ') + ' REMOVE lastUnmappedEventKey, lastUnmappedEventSummary, lastUnmappedEventStartTime',
    ExpressionAttributeValues: {
      ':u': userId,
      ':d': deviceId,
      ':c': calendarIds,
      ':e': upcomingEvents,
      ':m': minutesBefore,
      ':t': now.toISOString(),
      ':through': syncThrough ? syncThrough.toISOString() : null,
      ':f': false,
      ':tr': true,
    },
  }));
}

async function listReminderMappings(userId) {
  const result = await ddb.send(new QueryCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':prefix': 'REMINDER#',
    },
  }));

  return result.Items || [];
}

async function upsertReminderMappings(userId, mappings) {
  await Promise.all(mappings.map(mapping => ddb.send(new PutCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    Item: {
      pk: `USER#${userId}`,
      sk: reminderMappingSortKey(mapping.eventIdentityKey),
      userId,
      type: 'REMINDER_MAPPING',
      status: 'active',
      updatedAt: new Date().toISOString(),
      ...mapping,
    },
  }))));
}

async function deleteReminderMappings(userId, eventIdentityKeys) {
  await Promise.all(eventIdentityKeys.map(eventKey => ddb.send(new DeleteCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    Key: {
      pk: `USER#${userId}`,
      sk: reminderMappingSortKey(eventKey),
    },
  }))));
}

async function updateCalendarSelection(userId, calendarIds) {
  await ddb.send(new UpdateCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    Key: settingsKey(userId),
    UpdateExpression: 'SET userId = :u, calendarIds = :c, enabled = if_not_exists(enabled, :t), syncNeeded = :t, updatedAt = :now REMOVE upcomingEvents, lastCalendarSynced',
    ExpressionAttributeValues: {
      ':u': userId,
      ':c': calendarIds,
      ':t': true,
      ':now': new Date().toISOString(),
    },
  }));
}

async function updateReminderWindow(userId, minutesBefore) {
  await ddb.send(new UpdateCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    Key: settingsKey(userId),
    UpdateExpression: 'SET userId = :u, reminderMinutes = :m, enabled = if_not_exists(enabled, :t), syncNeeded = :t, updatedAt = :now',
    ExpressionAttributeValues: {
      ':u': userId,
      ':m': minutesBefore,
      ':t': true,
      ':now': new Date().toISOString(),
    },
  }));
}

/**
 * Marks the user as disabled — poller will skip them.
 * Called by DisableHandler.
 */
async function disableUser(userId) {
  await ddb.send(new UpdateCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    Key: settingsKey(userId),
    UpdateExpression: 'SET userId = :u, enabled = :f, updatedAt = :now',
    ExpressionAttributeValues: {
      ':u': userId,
      ':f': false,
      ':now': new Date().toISOString(),
    },
  }));
}

/**
 * Marks the user as enabled.
 * Called by SyncCalendarHandler (re-enables if previously disabled).
 */
async function enableUser(userId) {
  await ddb.send(new UpdateCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    Key: settingsKey(userId),
    UpdateExpression: 'SET userId = :u, enabled = :t, updatedAt = :now',
    ExpressionAttributeValues: {
      ':u': userId,
      ':t': true,
      ':now': new Date().toISOString(),
    },
  }));
}

async function deleteUserData(userId) {
  const keys = new Map();

  let queryStartKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: config.DYNAMODB_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
      },
      ExclusiveStartKey: queryStartKey,
    }));

    for (const item of result.Items || []) {
      keys.set(`${item.pk}|${item.sk}`, { pk: item.pk, sk: item.sk });
    }
    queryStartKey = result.LastEvaluatedKey;
  } while (queryStartKey);

  let scanStartKey;
  do {
    const result = await ddb.send(new ScanCommand({
      TableName: config.DYNAMODB_TABLE_NAME,
      FilterExpression: 'userId = :u AND pk <> :userPk',
      ExpressionAttributeValues: {
        ':u': userId,
        ':userPk': `USER#${userId}`,
      },
      ProjectionExpression: 'pk, sk',
      ExclusiveStartKey: scanStartKey,
    }));

    for (const item of result.Items || []) {
      keys.set(`${item.pk}|${item.sk}`, { pk: item.pk, sk: item.sk });
    }
    scanStartKey = result.LastEvaluatedKey;
  } while (scanStartKey);

  const items = Array.from(keys.values());
  await Promise.all(items.map(key => ddb.send(new DeleteCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    Key: key,
  }))));
}

module.exports = {
  deleteUserData,
  finishSync,
  getUserSettings,
  listReminderMappings,
  tryBeginSync,
  upsertUserIdentity,
  upsertReminderMappings,
  upsertUserSync,
  deleteReminderMappings,
  updateCalendarSelection,
  updateReminderWindow,
  disableUser,
  enableUser,
};
