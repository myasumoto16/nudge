/**
 * NextEventIntent — tells the user what their next calendar event is.
 * Read-only, doesn't create any reminders.
 */

const { getUpcomingEvents } = require('../services/googleCalendar');

const NextEventHandler = {
  canHandle(handlerInput) {
    return (
      handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
      handlerInput.requestEnvelope.request.intent.name === 'NextEventIntent'
    );
  },

  async handle(handlerInput) {
    const accessToken =
      handlerInput.requestEnvelope.context.System.user.accessToken;

    if (!accessToken) {
      return handlerInput.responseBuilder
        .speak("Please link your Google account in the Alexa app first.")
        .withLinkAccountCard()
        .getResponse();
    }

    let events;
    try {
      events = await getUpcomingEvents(accessToken, 24);
    } catch (err) {
      console.error('Google Calendar fetch error:', err);
      return handlerInput.responseBuilder
        .speak("I had trouble reading your calendar. Please try again.")
        .getResponse();
    }

    const timedEvents = events.filter(e => !e.isAllDay);

    if (timedEvents.length === 0) {
      return handlerInput.responseBuilder
        .speak("You have no upcoming events in the next 24 hours.")
        .getResponse();
    }

    const next = timedEvents[0];
    const now = new Date();
    const minutesUntil = Math.round((next.startTime - now) / 60000);

    let timePhrase;
    if (minutesUntil <= 1) {
      timePhrase = 'starting now';
    } else if (minutesUntil < 60) {
      timePhrase = `in ${minutesUntil} minutes`;
    } else {
      const hours = Math.floor(minutesUntil / 60);
      const mins = minutesUntil % 60;
      timePhrase = mins > 0
        ? `in ${hours} hour${hours > 1 ? 's' : ''} and ${mins} minutes`
        : `in ${hours} hour${hours > 1 ? 's' : ''}`;
    }

    return handlerInput.responseBuilder
      .speak(`Your next event is ${next.summary}, ${timePhrase}.`)
      .getResponse();
  },
};

module.exports = NextEventHandler;
