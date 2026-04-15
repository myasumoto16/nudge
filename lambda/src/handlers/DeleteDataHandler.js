const { deleteAllReminders } = require('../services/reminders');
const { deleteUserData } = require('../services/dynamodb');

const DeleteDataHandler = {
  canHandle(handlerInput) {
    return (
      handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
      handlerInput.requestEnvelope.request.intent.name === 'DeleteDataIntent'
    );
  },

  async handle(handlerInput) {
    const { context } = handlerInput.requestEnvelope;
    const userId = context.System.user.userId;
    const apiAccessToken = context.System.apiAccessToken;
    const apiEndpoint = context.System.apiEndpoint;

    let deletedReminders = 0;
    try {
      deletedReminders = await deleteAllReminders(apiAccessToken, apiEndpoint);
    } catch (err) {
      console.error('DeleteDataIntent reminder cleanup failed:', err.message);
    }

    try {
      await deleteUserData(userId);
    } catch (err) {
      console.error('DeleteDataIntent data cleanup failed:', err.message);
      return handlerInput.responseBuilder
        .speak("I couldn't delete your Nudge data right now. Please try again.")
        .getResponse();
    }

    const reminderClause = deletedReminders > 0
      ? ` I also removed ${deletedReminders} Alexa reminder${deletedReminders !== 1 ? 's' : ''} created by Nudge.`
      : '';

    return handlerInput.responseBuilder
      .speak(
        "I deleted your Nudge data, including linked account sync state, stored calendar settings, and reminder mappings." +
        reminderClause +
        " If you want to revoke Google account access completely, unlink Nudge or disable the skill in the Alexa app."
      )
      .getResponse();
  },
};

module.exports = DeleteDataHandler;
