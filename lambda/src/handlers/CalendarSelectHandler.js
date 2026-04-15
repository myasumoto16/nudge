/**
 * CalendarSelectIntent — lets user choose which calendars to monitor.
 *
 * "use all my calendars" → fetches from all visible Google calendars
 * "use only my primary calendar" → fetches from primary only
 *
 * Calendar selection is stored in session attributes for the current turn and
 * persisted to DynamoDB for background polling.
 */

const { listCalendars } = require('../services/googleCalendar');
const { updateCalendarSelection } = require('../services/dynamodb');
const { requestCalendarSync } = require('../services/calendarSync');

const CalendarSelectHandler = {
  canHandle(handlerInput) {
    return (
      handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
      handlerInput.requestEnvelope.request.intent.name === 'CalendarSelectIntent'
    );
  },

  async handle(handlerInput) {
    const { context } = handlerInput.requestEnvelope;
    const accessToken = context.System.user.accessToken;

    if (!accessToken) {
      return handlerInput.responseBuilder
        .speak("Please link your Google account in the Alexa app first.")
        .withLinkAccountCard()
        .getResponse();
    }

    const slots = handlerInput.requestEnvelope.request.intent.slots;
    const selection = slots && slots.calendarType && slots.calendarType.value
      ? slots.calendarType.value.toLowerCase()
      : 'all';

    let calendarIds;
    let speech;

    if (selection.includes('primary') || selection.includes('main')) {
      calendarIds = ['primary'];
      speech = "Got it — I'll only remind you about events from your primary calendar. Say 'sync my calendar' to update your reminders.";
    } else {
      // Fetch all visible calendars
      try {
        const calendars = await listCalendars(accessToken);
        const visible = calendars.filter(c => c.selected);
        calendarIds = visible.map(c => c.id);
        const names = visible.map(c => c.name).slice(0, 3).join(', ');
        speech = `Got it — I'll monitor ${visible.length} calendar${visible.length !== 1 ? 's' : ''}: ${names}${visible.length > 3 ? ' and more' : ''}. Say 'sync my calendar' to update your reminders.`;
      } catch (err) {
        console.error('Calendar list error:', err);
        return handlerInput.responseBuilder
          .speak("I had trouble reading your calendars. Please try again.")
          .getResponse();
      }
    }

    // Store in session for this sync
    const sessionAttrs = handlerInput.attributesManager.getSessionAttributes();
    sessionAttrs.calendarIds = calendarIds;
    handlerInput.attributesManager.setSessionAttributes(sessionAttrs);

    try {
      await updateCalendarSelection(context.System.user.userId, calendarIds);
      await requestCalendarSync(context.System.user.userId);
    } catch (err) {
      console.error('Calendar selection persistence failed:', err.message);
    }

    return handlerInput.responseBuilder
      .speak(speech)
      .reprompt("Say 'sync my calendar' to update your reminders.")
      .getResponse();
  },
};

module.exports = CalendarSelectHandler;
