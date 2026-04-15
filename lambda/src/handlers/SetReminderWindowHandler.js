/**
 * SetReminderWindowIntent — persists how early Nudge should announce events.
 *
 * Example: "remind me 5 minutes before."
 */

const { updateReminderWindow } = require('../services/dynamodb');
const { requestCalendarSync } = require('../services/calendarSync');

const ALLOWED_MINUTES = [5, 10, 15, 30, 60];

const SetReminderWindowHandler = {
  canHandle(handlerInput) {
    return (
      handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
      handlerInput.requestEnvelope.request.intent.name === 'SetReminderWindowIntent'
    );
  },

  async handle(handlerInput) {
    const { context, request } = handlerInput.requestEnvelope;
    const minutesSlot = request.intent.slots && request.intent.slots.minutes;
    const requestedMinutes = parseInt(minutesSlot && minutesSlot.value, 10);

    if (!requestedMinutes || Number.isNaN(requestedMinutes)) {
      return handlerInput.responseBuilder
        .speak("How many minutes before events should I remind you? You can say 5, 10, 15, 30, or 60 minutes.")
        .reprompt("Say 5, 10, 15, 30, or 60 minutes.")
        .getResponse();
    }

    if (!ALLOWED_MINUTES.includes(requestedMinutes)) {
      return handlerInput.responseBuilder
        .speak("I can remind you 5, 10, 15, 30, or 60 minutes before events. Try saying, remind me 10 minutes before.")
        .reprompt("Say 5, 10, 15, 30, or 60 minutes.")
        .getResponse();
    }

    try {
      await updateReminderWindow(context.System.user.userId, requestedMinutes);
      await requestCalendarSync(context.System.user.userId);
    } catch (err) {
      console.error('SetReminderWindowIntent error:', err);
      return handlerInput.responseBuilder
        .speak("I had trouble saving that reminder timing. Please try again.")
        .getResponse();
    }

    return handlerInput.responseBuilder
      .speak(`Got it. I'll announce events ${requestedMinutes} minutes before they start.`)
      .getResponse();
  },
};

module.exports = SetReminderWindowHandler;
