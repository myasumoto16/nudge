const https = require('https');

let cachedToken = null;
let tokenExpiresAt = 0;

async function sendReminderUpdate(userId, mapping, event, minutesBefore) {
  const scheduledTime = formatInTimezone(
    new Date(event.startTime.getTime() - minutesBefore * 60 * 1000),
    event.timezone || mapping.timezone || 'UTC'
  );

  await sendSkillMessage(userId, {
    operation: 'UPDATE',
    alertToken: mapping.alertToken,
    summary: event.summary,
    scheduledTime,
    timezone: event.timezone || mapping.timezone || 'UTC',
    minutesBefore: String(minutesBefore),
  });
}

async function sendReminderDelete(userId, mapping) {
  await sendSkillMessage(userId, {
    operation: 'DELETE',
    alertToken: mapping.alertToken,
  });
}

async function sendSkillMessage(userId, data) {
  const token = await getSkillMessagingToken();
  const body = JSON.stringify({
    data,
    expiresAfterSeconds: 36000,
  });

  await request({
    hostname: 'api.amazonalexa.com',
    path: `/v1/skillmessages/users/${encodeURIComponent(userId)}`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
}

async function getSkillMessagingToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'alexa:skill_messaging',
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

module.exports = {
  sendReminderDelete,
  sendReminderUpdate,
};
