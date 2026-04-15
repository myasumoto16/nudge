/**
 * Token Proxy Lambda — API Gateway backed
 *
 * Sits between Alexa's account linking and Google's OAuth token endpoint.
 * Configured as the Token URL in Alexa account linking (instead of Google's directly).
 *
 * On authorization_code exchange:
 *   - Forwards to Google to exchange code for tokens
 *   - Captures refresh_token, stores it in DynamoDB keyed by Google user sub
 *     (later associated with Alexa userId on first skill invocation)
 *   - Returns access_token + refresh_token to Alexa normally
 *
 * On refresh_token grant:
 *   - Pass-through to Google (Alexa manages its own refresh)
 *
 * Why we key by Google sub initially:
 *   At token exchange time, Alexa hasn't told us the userId yet.
 *   LaunchHandler associates the sub→refreshToken with the Alexa userId
 *   on first skill open, using the access_token to call Google's tokeninfo endpoint.
 *
 * Setup:
 *   1. Deploy this Lambda + API Gateway: POST /token
 *   2. In Alexa console → Account Linking → Token URL = your API Gateway URL
 *   3. Ensure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, DYNAMODB_TABLE_NAME are set
 */

const https = require('https');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { encryptToken } = require('./tokenCrypto');

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(dbClient);
const TABLE = process.env.DYNAMODB_TABLE_NAME || 'NudgeUsers';

exports.handler = async (event) => {
  // API Gateway passes the body as a string (URL-encoded form)
  const body = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  const params = new URLSearchParams(body);
  const grantType = params.get('grant_type');

  let googleResponse;
  try {
    googleResponse = await forwardToGoogle(body);
  } catch (err) {
    console.error('Google token exchange failed:', err.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'upstream_error', error_description: err.message }),
    };
  }

  // On initial code exchange, capture the refresh token
  if (grantType === 'authorization_code' && googleResponse.refresh_token) {
    const sub = extractGoogleSub(googleResponse.id_token);
    if (sub) {
      // Store refresh token keyed by Google sub (temporary; associated with Alexa userId on launch)
      try {
        await storeRefreshToken(sub, googleResponse.refresh_token);
      } catch (err) {
        console.error('Failed to store refresh token:', err.message);
      }
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(googleResponse),
  };
};

/**
 * Forwards the token request body to Google's token endpoint as-is.
 * Uses our client credentials (from env vars) if not already in the body.
 */
function forwardToGoogle(originalBody) {
  // Ensure our client credentials are included (Alexa may or may not send them)
  const params = new URLSearchParams(originalBody);
  if (!params.get('client_id')) params.set('client_id', process.env.GOOGLE_CLIENT_ID);
  if (!params.get('client_secret')) params.set('client_secret', process.env.GOOGLE_CLIENT_SECRET);
  const body = params.toString();

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Google token error ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Decodes the Google id_token JWT to extract the `sub` claim (Google user ID).
 * No signature verification needed — we just got this from Google's own endpoint.
 */
function extractGoogleSub(idToken) {
  if (!idToken) return null;
  try {
    const encoded = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(encoded, 'base64').toString());
    return payload.sub || null;
  } catch {
    return null;
  }
}

/**
 * Stores the refresh token in DynamoDB keyed by `google:{sub}`.
 * LaunchHandler reads this on first skill launch to associate it with the Alexa userId.
 */
async function storeRefreshToken(googleSub, refreshToken) {
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: `GOOGLE#${googleSub}`, sk: 'TOKEN' },
    UpdateExpression: 'SET googleSub = :s, googleRefreshToken = :r, storedAt = :t, expiresAt = :ttl',
    ExpressionAttributeValues: {
      ':s': googleSub,
      ':r': encryptToken(refreshToken),
      ':t': new Date().toISOString(),
      ':ttl': Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
    },
  }));
}
