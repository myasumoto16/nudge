/**
 * Catch-all error handler — logs the error and gives a graceful response.
 * Alexa requires every skill to have an error handler.
 */

const ErrorHandler = {
  canHandle() {
    return true;
  },

  handle(handlerInput, error) {
    console.error('Unhandled error:', error);
    return handlerInput.responseBuilder
      .speak("Sorry, something went wrong. Please try again.")
      .getResponse();
  },
};

module.exports = ErrorHandler;
