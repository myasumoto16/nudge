/**
 * LaunchRequest — fired when user says "Alexa, open Nudge"
 *
 * If the user hasn't linked their Google account yet, prompt them to do so.
 * Otherwise, give a quick status and offer to sync.
 *
 * Also stores userId + deviceId in DynamoDB so the poller Lambda
 * knows which device to send Proactive Events to.
 */

const { upsertUserIdentity } = require('../services/dynamodb');
const { requestCalendarSync } = require('../services/calendarSync');
const { linkRefreshToken } = require('../services/tokenLink');

const LaunchHandler = {
  canHandle(handlerInput) {
    return (
      handlerInput.requestEnvelope.request.type === 'LaunchRequest'
    );
  },

  async handle(handlerInput) {
    const { context } = handlerInput.requestEnvelope;
    const accessToken = context.System.user.accessToken;

    if (!accessToken) {
      return handlerInput.responseBuilder
        .speak(
          "Welcome to Nudge. To get started, open the Alexa app, go to your skills, find Nudge, and link your Google account."
        )
        .withLinkAccountCard()
        .getResponse();
    }

    // Store userId + deviceId so the poller knows which device to announce on.
    // Also attempt to link the Google refresh token (from token proxy) to this userId.
    // Await this work so Lambda does not freeze the Node process before it runs.
    const userId = context.System.user.userId;
    const deviceId = context.System.device.deviceId;
    try {
      await upsertUserIdentity(userId, deviceId);
      await linkRefreshToken(userId, accessToken);
      await requestCalendarSync(userId);
    } catch (err) {
      console.error('DynamoDB/token link failed on launch:', err.message);
    }

    return handlerInput.responseBuilder
      .speak(
        "Nudge is ready. Say 'sync my calendar' to create reminders for your upcoming events, 'what's next' to hear your next event, or set up an Echo routine with 'run quiet sync' to keep new events refreshed automatically."
      )
      .reprompt("Say 'sync my calendar' to create reminders, or 'what's next' to hear upcoming events.")
      .getResponse();
  },
};

module.exports = LaunchHandler;
