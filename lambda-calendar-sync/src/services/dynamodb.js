const crypto = require('crypto');
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
const { reminderMappingSortKey } = require('./eventIdentity');
const { getReminderMinutesBefore } = require('./reminderPresentation');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);
const TABLE = process.env.DYNAMODB_TABLE_NAME || 'NudgeUsers';

function settingsKey(userId) {
  return { pk: `USER#${userId}`, sk: 'SETTINGS' };
}

function calendarKey(userId, calendarId) {
  return { pk: `USER#${userId}`, sk: `CALENDAR#${calendarId}` };
}

function watchKey(channelId) {
  return { pk: `WATCH#${channelId}`, sk: 'META' };
}

function eventPointerKey(userId, calendarId, eventId) {
  return { pk: `EVENT#${userId}#${calendarId}#${eventId}`, sk: 'DUE' };
}

function dueMinuteKey(date) {
  const d = new Date(date);
  d.setUTCSeconds(0, 0);
  return d.toISOString().slice(0, 16) + 'Z';
}

async function getUserSettings(userId) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: settingsKey(userId),
  }));
  return result.Item || null;
}

async function listUserSettings() {
  const items = [];
  let ExclusiveStartKey;

  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLE,
      ExclusiveStartKey,
      FilterExpression: 'sk = :settings AND enabled = :enabled',
      ExpressionAttributeValues: {
        ':settings': 'SETTINGS',
        ':enabled': true,
      },
    }));
    items.push(...(result.Items || []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

async function getCalendarState(userId, calendarId) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: calendarKey(userId, calendarId),
  }));
  return result.Item || null;
}

async function saveCalendarState(userId, calendarId, values) {
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: calendarKey(userId, calendarId),
    UpdateExpression: [
      'SET userId = :u',
      'calendarId = :c',
      'syncToken = :s',
      'lastSyncedAt = :now',
    ].join(', '),
    ExpressionAttributeValues: {
      ':u': userId,
      ':c': calendarId,
      ':s': values.syncToken || null,
      ':now': new Date().toISOString(),
    },
  }));
}

async function saveWatch(userId, calendarId, watch) {
  const tokenHash = hashToken(watch.token);

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      ...watchKey(watch.channelId),
      channelId: watch.channelId,
      channelTokenHash: tokenHash,
      resourceId: watch.resourceId,
      userId,
      calendarId,
      expiration: watch.expiration,
      updatedAt: new Date().toISOString(),
    },
  }));

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: calendarKey(userId, calendarId),
    UpdateExpression: [
      'SET userId = :u',
      'calendarId = :c',
      'watchChannelId = :ch',
      'watchResourceId = :r',
      'watchExpiration = :e',
      'updatedAt = :now',
    ].join(', '),
    ExpressionAttributeValues: {
      ':u': userId,
      ':c': calendarId,
      ':ch': watch.channelId,
      ':r': watch.resourceId,
      ':e': watch.expiration,
      ':now': new Date().toISOString(),
    },
  }));
}

async function getWatch(channelId) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: watchKey(channelId),
  }));
  return result.Item || null;
}

async function getReminderMapping(userId, eventKey) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: {
      pk: `USER#${userId}`,
      sk: reminderMappingSortKey(eventKey),
    },
  }));
  return result.Item || null;
}

async function listReminderMappings(userId) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':prefix': 'REMINDER#',
    },
  }));
  return result.Items || [];
}

async function updateReminderMappingAfterBackgroundSync(userId, mapping, event, reminderMinutes) {
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: `USER#${userId}`, sk: mapping.sk },
    UpdateExpression: [
      'SET summary = :summary',
      'eventStartTime = :start',
      'reminderTime = :reminderTime',
      'reminderMinutes = :minutes',
      '#timezone = :timezone',
      'updatedOutOfSessionAt = :now',
    ].join(', '),
    ExpressionAttributeNames: {
      '#timezone': 'timezone',
    },
    ExpressionAttributeValues: {
      ':summary': event.summary,
      ':start': event.startTime.toISOString(),
      ':reminderTime': new Date(event.startTime.getTime() - reminderMinutes * 60 * 1000).toISOString(),
      ':minutes': reminderMinutes,
      ':timezone': event.timezone || mapping.timezone || 'UTC',
      ':now': new Date().toISOString(),
    },
  }));
}

async function markReminderMappingDeleted(userId, mapping) {
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: `USER#${userId}`, sk: mapping.sk },
    UpdateExpression: 'SET #status = :deleted, updatedOutOfSessionAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':deleted': 'deleted',
      ':now': new Date().toISOString(),
    },
  }));
}

async function markNeedsSpokenReminderSync(userId, event) {
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: settingsKey(userId),
    UpdateExpression: [
      'SET needsSpokenReminderSync = :needsSync',
      'lastNeedsSpokenReminderSyncAt = :now',
      'lastUnmappedEventKey = :eventKey',
      'lastUnmappedEventSummary = :summary',
      'lastUnmappedEventStartTime = :start',
    ].join(', '),
    ExpressionAttributeValues: {
      ':needsSync': true,
      ':now': new Date().toISOString(),
      ':eventKey': `${event.calendarId}:${event.id}`,
      ':summary': event.summary,
      ':start': event.startTime.toISOString(),
    },
  }));
}

async function reserveSyncNudgeNotification(userId, intervalHours = 24) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - intervalHours * 60 * 60 * 1000).toISOString();

  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: settingsKey(userId),
      UpdateExpression: 'SET lastSyncNudgeNotificationAt = :now',
      ConditionExpression: [
        'attribute_not_exists(lastSyncNudgeNotificationAt)',
        'OR lastSyncNudgeNotificationAt < :cutoff',
      ].join(' '),
      ExpressionAttributeValues: {
        ':now': now.toISOString(),
        ':cutoff': cutoff,
      },
    }));
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw err;
  }
}

async function upsertDueEvent(settings, event) {
  const reminderMinutes = getReminderMinutesBefore(event, settings.reminderMinutes || 10);
  const dueTime = new Date(event.startTime.getTime() - reminderMinutes * 60 * 1000);
  if (dueTime <= new Date()) return deleteDueEventPointer(settings.userId, event.calendarId, event.id);

  const pointerKey = eventPointerKey(settings.userId, event.calendarId, event.id);
  const existingPointer = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: pointerKey,
  }));

  if (existingPointer.Item) {
    await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { pk: existingPointer.Item.duePk, sk: existingPointer.Item.dueSk },
    }));
  }

  const dueMinute = dueMinuteKey(dueTime);
  const duePk = `DUE#${dueMinute}`;
  const dueSk = `USER#${settings.userId}#CAL#${event.calendarId}#EVENT#${event.id}`;
  const eventKey = `${event.calendarId}:${event.id}:${event.startTime.toISOString()}:${reminderMinutes}`;

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      pk: duePk,
      sk: dueSk,
      userId: settings.userId,
      calendarId: event.calendarId,
      eventId: event.id,
      eventKey,
      summary: event.summary,
      startTime: event.startTime.toISOString(),
      dueTime: dueTime.toISOString(),
      reminderMinutes,
      status: 'pending',
      expiresAt: Math.floor((dueTime.getTime() + 60 * 60 * 1000) / 1000),
    },
  }));

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      ...pointerKey,
      duePk,
      dueSk,
      userId: settings.userId,
      calendarId: event.calendarId,
      eventId: event.id,
      updatedAt: new Date().toISOString(),
    },
  }));
}

async function deleteDueEventPointer(userId, calendarId, eventId) {
  const pointerKey = eventPointerKey(userId, calendarId, eventId);
  const existingPointer = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: pointerKey,
  }));

  if (existingPointer.Item) {
    await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { pk: existingPointer.Item.duePk, sk: existingPointer.Item.dueSk },
    }));
  }

  await ddb.send(new DeleteCommand({
    TableName: TABLE,
    Key: pointerKey,
  }));
}

function verifyWatchToken(watch, token) {
  return watch.channelTokenHash === hashToken(token || '');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token || '').digest('hex');
}

module.exports = {
  deleteDueEventPointer,
  getCalendarState,
  getUserSettings,
  getWatch,
  getReminderMapping,
  listUserSettings,
  listReminderMappings,
  markNeedsSpokenReminderSync,
  markReminderMappingDeleted,
  reserveSyncNudgeNotification,
  saveCalendarState,
  saveWatch,
  updateReminderMappingAfterBackgroundSync,
  upsertDueEvent,
  verifyWatchToken,
};
