/**
 * Links the Google refresh token captured during Alexa account linking to the
 * Alexa user record. The token proxy stores it temporarily under GOOGLE#{sub}.
 */

const https = require('https');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const config = require('../config');

const dbClient = new DynamoDBClient({ region: config.AWS_REGION });
const ddb = DynamoDBDocumentClient.from(dbClient);

async function linkRefreshToken(userId, accessToken) {
  const sub = await getGoogleSub(accessToken);
  if (!sub) {
    console.log('Token link skipped: no Google sub returned');
    return false;
  }

  const proxyRecord = await ddb.send(new GetCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    Key: { pk: `GOOGLE#${sub}`, sk: 'TOKEN' },
  }));

  if (!proxyRecord.Item || !proxyRecord.Item.googleRefreshToken) {
    console.log('Token link skipped: no proxy token record found');
    return false;
  }

  await ddb.send(new UpdateCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    Key: { pk: `USER#${userId}`, sk: 'SETTINGS' },
    UpdateExpression: 'SET userId = :u, googleRefreshToken = :r, googleSub = :s, syncNeeded = :t, updatedAt = :now',
    ExpressionAttributeValues: {
      ':u': userId,
      ':r': proxyRecord.Item.googleRefreshToken,
      ':s': sub,
      ':t': true,
      ':now': new Date().toISOString(),
    },
  }));

  await ddb.send(new DeleteCommand({
    TableName: config.DYNAMODB_TABLE_NAME,
    Key: { pk: `GOOGLE#${sub}`, sk: 'TOKEN' },
  }));

  console.log('Token link complete');
  return true;
}

function getGoogleSub(accessToken) {
  return new Promise((resolve) => {
    https.get(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const info = JSON.parse(data);
            resolve(info.sub || null);
          } catch {
            resolve(null);
          }
        });
      }
    ).on('error', () => resolve(null));
  });
}

module.exports = {
  linkRefreshToken,
};
