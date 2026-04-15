const crypto = require('crypto');
const https = require('https');
const { decryptToken } = require('./tokenCrypto');

const TOKEN_HOST = 'oauth2.googleapis.com';
const CALENDAR_HOST = 'www.googleapis.com';

async function refreshAccessToken(refreshToken) {
  const decryptedRefreshToken = decryptToken(refreshToken);
  const body = new URLSearchParams({
    client_id: requiredEnv('GOOGLE_CLIENT_ID'),
    client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
    refresh_token: decryptedRefreshToken,
    grant_type: 'refresh_token',
  }).toString();

  const data = await request({
    hostname: TOKEN_HOST,
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  if (!data.access_token) throw new Error('Google refresh response did not include access_token');
  return data.access_token;
}

async function fullSyncEvents(accessToken, calendarId, hoursAhead) {
  const now = new Date();
  const maxTime = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
  const result = await listEvents(accessToken, calendarId, {
    timeMin: now.toISOString(),
    timeMax: maxTime.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    showDeleted: 'true',
  });
  return {
    ...result,
    calendarDefaultReminders: await getCalendarDefaultReminders(accessToken, calendarId),
  };
}

async function incrementalSyncEvents(accessToken, calendarId, syncToken) {
  const result = await listEvents(accessToken, calendarId, {
    syncToken,
    showDeleted: 'true',
  });
  return {
    ...result,
    calendarDefaultReminders: await getCalendarDefaultReminders(accessToken, calendarId),
  };
}

async function watchEvents(accessToken, calendarId) {
  const channelId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('hex');
  const body = JSON.stringify({
    id: channelId,
    type: 'web_hook',
    address: requiredEnv('GOOGLE_WEBHOOK_URL'),
    token,
    params: {
      ttl: String(process.env.WATCH_TTL_SECONDS || 604800),
    },
  });

  const data = await request({
    hostname: CALENDAR_HOST,
    path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  return {
    channelId,
    token,
    resourceId: data.resourceId,
    expiration: data.expiration ? new Date(Number(data.expiration)).toISOString() : null,
  };
}

async function listEvents(accessToken, calendarId, params) {
  let pageToken = null;
  const items = [];
  let nextSyncToken = null;

  do {
    const query = new URLSearchParams(params);
    if (pageToken) query.set('pageToken', pageToken);

    const data = await request({
      hostname: CALENDAR_HOST,
      path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    items.push(...(data.items || []));
    pageToken = data.nextPageToken || null;
    nextSyncToken = data.nextSyncToken || nextSyncToken;
  } while (pageToken);

  return { items, nextSyncToken };
}

async function getCalendarDefaultReminders(accessToken, calendarId) {
  const data = await request({
    hostname: CALENDAR_HOST,
    path: `/calendar/v3/users/me/calendarList/${encodeURIComponent(calendarId)}`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return data.defaultReminders || [];
}

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = data ? JSON.parse(data) : null;
        } catch {
          reject(new Error(`Invalid JSON from ${options.hostname}: ${data}`));
          return;
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed || {});
        } else {
          const err = new Error(`${options.hostname} ${res.statusCode}: ${data}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}

module.exports = {
  fullSyncEvents,
  incrementalSyncEvents,
  refreshAccessToken,
  watchEvents,
};
