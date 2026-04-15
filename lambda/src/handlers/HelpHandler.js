const HelpHandler = {
  canHandle(handlerInput) {
    return (
      handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
      handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent'
    );
  },

  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(
        "Nudge reminds you about Google Calendar events before they start. " +
        "Say 'sync my calendar' to create reminders for your upcoming events, " +
        "'what's next' to hear your next event, " +
        "or set up an Echo routine that runs 'ask nudge to run quiet sync' during the day to keep new events refreshed automatically."
      )
      .reprompt("Say 'sync my calendar' to create reminders.")
      .getResponse();
  },
};

module.exports = HelpHandler;
