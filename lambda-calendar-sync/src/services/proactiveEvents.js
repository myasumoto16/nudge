const https = require('https');

let cachedToken = null;
let tokenExpiresAt = 0;

async function sendSyncNudgeNotification(userId, eventSummary) {
  const token = await getLwaToken();
  const now = new Date();
  const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const subject = 'New event added. Sync calendar.';

  const payload = {
    timestamp: now.toISOString(),
    referenceId: `sync-nudge-${userId.slice(-8)}-${now.toISOString().replace(/[^0-9]/g, '').slice(0, 12)}`,
    expiryTime: expiry.toISOString(),
    event: {
      name: 'AMAZON.Occasion.Updated',
      payload: {
        state: { confirmationStatus: 'CONFIRMED' },
        occasion: {
          occasionType: 'APPOINTMENT',
          subject: 'localizedattribute:subject',
          provider: { name: 'localizedattribute:providerName' },
          bookingTime: expiry.toISOString(),
          broker: { name: 'localizedattribute:brokerName' },
        },
      },
    },
    localizedAttributes: [
      {
        locale: 'en-US',
        subject,
        providerName: 'Nudge',
        brokerName: 'Nudge',
      },
    ],
    relevantAudience: {
      type: 'Unicast',
      payload: { user: userId },
    },
  };

  const body = JSON.stringify(payload);
  await request({
    hostname: 'api.amazonalexa.com',
    path: process.env.PROACTIVE_EVENTS_PATH || '/v1/proactiveEvents/stages/development',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
}

async function getLwaToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'alexa::proactive_events',
    client_id: requiredEnv('LWA_CLIENT_ID'),
    client_secret: requiredEnv('LWA_CLIENT_SECRET'),
  }).toString();

  const data = await request({
    hostname: 'api.amazon.com',
    path: '/auth/o2/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000);
  return cachedToken;
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
          reject(new Error(`${options.hostname} ${res.statusCode}: ${data}`));
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

module.exports = { sendSyncNudgeNotification };
