/**
 * DisableIntent — deletes skill-created reminders and pauses background announcements.
 * User says "disable", "stop reminders", "pause", etc.
 */

const { deleteAllReminders } = require('../services/reminders');
const { disableUser } = require('../services/dynamodb');

const DisableHandler = {
  canHandle(handlerInput) {
    return (
      handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
      handlerInput.requestEnvelope.request.intent.name === 'DisableIntent'
    );
  },

  async handle(handlerInput) {
    const { context } = handlerInput.requestEnvelope;
    const apiAccessToken = context.System.apiAccessToken;
    const apiEndpoint = context.System.apiEndpoint;

    try {
      const deleted = await deleteAllReminders(apiAccessToken, apiEndpoint);
      try {
        await disableUser(context.System.user.userId);
      } catch (err) {
        console.error('DisableIntent persistence failed:', err.message);
      }
      const speech = deleted > 0
        ? `Done — I've cancelled all ${deleted} upcoming reminder${deleted !== 1 ? 's' : ''} and paused automatic announcements. Say 'sync my calendar' anytime to turn them back on.`
        : "You don't have any active reminders from Nudge right now. I also paused automatic announcements.";
      return handlerInput.responseBuilder.speak(speech).getResponse();
    } catch (err) {
      console.error('DisableIntent error:', err);
      return handlerInput.responseBuilder
        .speak("Something went wrong cancelling your reminders. Please try again.")
        .getResponse();
    }
  },
};

module.exports = DisableHandler;
