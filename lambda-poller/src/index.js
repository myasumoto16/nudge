/**
 * Nudge Due Checker Lambda
 *
 * Triggered by EventBridge every minute. Queries the current due-time bucket in
 * DynamoDB and sends Alexa Proactive Events. Normal operation does not call
 * Google Calendar.
 */

const {
  deleteDueEvent,
  getDueEvents,
  getUserSettings,
  markEventAnnounced,
} = require('./services/dynamodb');
const { getLwaToken, sendOccasionEvent } = require('./services/proactiveEvents');

exports.handler = async () => {
  const now = new Date();
  let eventsSent = 0;
  let eventsSkipped = 0;
  const settingsCache = new Map();

  let lwaToken;
  try {
    lwaToken = await getLwaToken();
  } catch (err) {
    console.error('Failed to fetch LWA token — aborting:', err.message);
    return;
  }

  const dueEvents = await getDueEvents(now, parseInt(process.env.DUE_GRACE_MINUTES || '2', 10));
  console.log(`Due checker running: ${dueEvents.length} due event(s) found`);

  for (const event of dueEvents) {
    const settings = await getCachedSettings(settingsCache, event.userId);
    if (!settings || !settings.enabled) {
      eventsSkipped++;
      continue;
    }

    if (settings.announcedEvents && settings.announcedEvents[event.eventKey]) {
      await deleteDueEvent(event);
      eventsSkipped++;
      continue;
    }

    try {
      await sendOccasionEvent(
        lwaToken,
        event.userId,
        event.summary || 'Untitled event',
        new Date(event.startTime),
        event.reminderMinutes || settings.reminderMinutes || 10
      );
      await markEventAnnounced(event.userId, event.eventKey);
      await deleteDueEvent(event);
      eventsSent++;
    } catch (err) {
      console.error(`Failed to send due event for userId=...${event.userId.slice(-8)} event="${event.summary}":`, err.message);
    }
  }

  console.log(`Due checker done: ${eventsSent} sent, ${eventsSkipped} skipped`);
};

async function getCachedSettings(cache, userId) {
  if (!cache.has(userId)) {
    cache.set(userId, await getUserSettings(userId));
  }
  return cache.get(userId);
}
