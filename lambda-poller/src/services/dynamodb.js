/**
 * DynamoDB service — due checker Lambda side
 *
 * Reads due-time event buckets and user settings from the single-table
 * `pk`/`sk` schema. The due checker should not scan users or call Google
 * Calendar during normal operation.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);
const TABLE = process.env.DYNAMODB_TABLE_NAME || 'NudgeUsers';

function dueMinuteKey(date) {
  const d = new Date(date);
  d.setUTCSeconds(0, 0);
  return d.toISOString().slice(0, 16) + 'Z';
}

function userSettingsKey(userId) {
  return { pk: `USER#${userId}`, sk: 'SETTINGS' };
}

async function getDueEvents(now = new Date(), graceMinutes = 2) {
  const buckets = [];
  for (let i = 0; i <= graceMinutes; i++) {
    buckets.push(new Date(now.getTime() - i * 60 * 1000));
  }

  const allEvents = [];
  for (const bucketDate of buckets) {
    const pk = `DUE#${dueMinuteKey(bucketDate)}`;
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': pk },
    }));
    allEvents.push(...(result.Items || []));
  }

  return allEvents;
}

async function getUserSettings(userId) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: userSettingsKey(userId),
  }));
  return result.Item || null;
}

async function markEventAnnounced(userId, eventKey) {
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: userSettingsKey(userId),
    UpdateExpression: 'SET announcedEvents = if_not_exists(announcedEvents, :empty)',
    ExpressionAttributeValues: { ':empty': {} },
  }));

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: userSettingsKey(userId),
    UpdateExpression: 'SET announcedEvents.#key = :ts',
    ExpressionAttributeNames: { '#key': eventKey },
    ExpressionAttributeValues: { ':ts': new Date().toISOString() },
  }));
}

async function deleteDueEvent(event) {
  await ddb.send(new DeleteCommand({
    TableName: TABLE,
    Key: { pk: event.pk, sk: event.sk },
  }));
}

module.exports = {
  deleteDueEvent,
  dueMinuteKey,
  getDueEvents,
  getUserSettings,
  markEventAnnounced,
};
