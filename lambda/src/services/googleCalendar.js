/**
 * Google Calendar service
 *
 * Alexa account linking gives us the user's Google OAuth access token
 * via handlerInput.requestEnvelope.context.System.user.accessToken.
 * Alexa handles token refresh automatically before each skill invocation.
 */

const { google } = require('googleapis');
const config = require('../config');

function getCalendarClient(accessToken) {
  const auth = new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: 'v3', auth });
}

/**
 * Returns all calendars the user has, with id, summary, and primary flag.
 * Used to let users choose which calendars to monitor.
 */
async function listCalendars(accessToken) {
  const calendar = getCalendarClient(accessToken);
  const response = await calendar.calendarList.list();
  const items = response.data.items || [];
  return items.map(cal => ({
    id: cal.id,
    name: cal.summary,
    isPrimary: cal.primary === true,
    selected: cal.selected !== false, // respects user's Google Calendar visibility settings
  }));
}

/**
 * Fetches events from specified calendars starting within the next `hoursAhead` hours.
 * calendarIds: array of calendar IDs to fetch from. Defaults to ['primary'].
 */
async function getUpcomingEvents(accessToken, hoursAhead = 24, calendarIds = ['primary']) {
  const calendar = getCalendarClient(accessToken);
  const now = new Date();
  const maxTime = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

  const allEvents = [];
  const calendarDefaults = await getCalendarReminderDefaults(calendar);

  for (const calendarId of calendarIds) {
    try {
      const response = await calendar.events.list({
        calendarId,
        timeMin: now.toISOString(),
        timeMax: maxTime.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const items = response.data.items || [];
      console.log(`Calendar fetch [${calendarId}]: found=${items.length}`);;

      items
        .filter(event => event.start && (event.start.dateTime || event.start.date))
        .forEach(event => {
          allEvents.push({
            id: event.id,
            calendarId,
            summary: event.summary || 'Untitled event',
            description: event.description || '',
            status: event.status || 'confirmed',
            transparency: event.transparency || 'opaque',
            timezone: event.start.timeZone || 'UTC',
            reminders: event.reminders || { useDefault: true },
            calendarDefaultReminders: calendarDefaults.get(calendarId) || [],
            startTime: event.start.dateTime
              ? new Date(event.start.dateTime)
              : new Date(event.start.date),
            isAllDay: !event.start.dateTime,
          });
        });
    } catch (err) {
      console.error(`Failed to fetch calendar [${calendarId}]:`, err.message);
      // Continue with other calendars if one fails
    }
  }

  // Sort all events by start time across calendars
  allEvents.sort((a, b) => a.startTime - b.startTime);

  return allEvents;
}

async function getCalendarReminderDefaults(calendar) {
  const defaults = new Map();

  try {
    const response = await calendar.calendarList.list();
    const items = response.data.items || [];
    for (const item of items) {
      defaults.set(item.id, item.defaultReminders || []);
    }
  } catch (err) {
    console.error('Failed to fetch calendar defaults:', err.message);
  }

  return defaults;
}

module.exports = { getUpcomingEvents, listCalendars };
