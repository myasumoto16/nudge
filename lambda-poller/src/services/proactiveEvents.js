/**
 * Proactive Events service
 *
 * Handles two things:
 * 1. LWA client credentials token fetch (Login with Amazon)
 * 2. Sending AMAZON.Occasion.Updated proactive events to Alexa users
 *
 * Authentication: client_credentials grant (not user-delegated).
 * Credentials come from Alexa developer console → Build → Permissions → Proactive Events.
 *
 * Alexa speaks: "Your appointment [subject] is coming up."
 *
 * Docs: https://developer.amazon.com/docs/smapi/proactive-events-api.html
 */

const https = require('https');

// Module-level token cache to avoid fetching on every poll invocation
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Fetches an LWA bearer token using client credentials.
 * Caches for the token lifetime minus 60s buffer.
 */
async function getLwaToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const clientId = process.env.LWA_CLIENT_ID;
  const clientSecret = process.env.LWA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('LWA_CLIENT_ID and LWA_CLIENT_SECRET env vars are required');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'alexa::proactive_events',
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  const data = await httpsPost('api.amazon.com', '/auth/o2/token', body, {
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000);
  return cachedToken;
}

/**
 * Sends a proactive Occasion.Updated event to a specific Alexa user.
 * Uses the development staging endpoint — safe to call without skill certification.
 *
 * @param {string} bearerToken  - from getLwaToken()
 * @param {string} userId       - Alexa userId (amzn1.ask.account.XXX)
 * @param {string} eventSummary - calendar event name
 * @param {Date}   eventStartTime
 * @param {number} minutesBefore - how many minutes before the event this fires
 */
async function sendOccasionEvent(bearerToken, userId, eventSummary, eventStartTime, minutesBefore) {
  const now = new Date();
  // referenceId must be unique per event — use last 8 chars of userId + start time
  const referenceId = `nudge-${userId.slice(-8)}-${eventStartTime.toISOString().replace(/[^0-9]/g, '').slice(0, 12)}`;
  const subject = eventSummary.slice(0, 60);

  const payload = {
    timestamp: now.toISOString(),
    referenceId,
    expiryTime: eventStartTime.toISOString(), // expires when event starts
    event: {
      name: 'AMAZON.Occasion.Updated',
      payload: {
        state: { confirmationStatus: 'CONFIRMED' },
        occasion: {
          occasionType: 'APPOINTMENT',
          subject: 'localizedattribute:subject',
          provider: { name: 'localizedattribute:providerName' },
          bookingTime: eventStartTime.toISOString(),
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

  const bodyStr = JSON.stringify(payload);

  // Use the development staging endpoint — works without certification
  await httpsPost(
    'api.amazonalexa.com',
    process.env.PROACTIVE_EVENTS_PATH || '/v1/proactiveEvents/stages/development',
    bodyStr,
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    }
  );

  console.log(`Proactive event sent: userId=...${userId.slice(-8)} event="${eventSummary}"`);
}

function httpsPost(hostname, path, body, headers) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : null);
        } else {
          reject(new Error(`Proactive Events API ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { getLwaToken, sendOccasionEvent };
