const { REMINDER_MINUTES_BEFORE } = require('../config');
const { buildReminderText } = require('../services/reminderPresentation');

const MessageReceivedHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'Messaging.MessageReceived';
  },

  async handle(handlerInput) {
    const { requestEnvelope, serviceClientFactory } = handlerInput;
    const message = requestEnvelope.request.message || {};
    const { operation, alertToken } = message;

    if (!alertToken) {
      console.error('Reminder message missing alertToken');
      return handlerInput.responseBuilder.getResponse();
    }

    const client = serviceClientFactory.getReminderManagementServiceClient();

    try {
      if (operation === 'DELETE') {
        await client.deleteReminder(alertToken);
        console.log(`Reminder message delete complete: alertToken=...${alertToken.slice(-8)}`);
        return handlerInput.responseBuilder.getResponse();
      }

      if (operation === 'UPDATE') {
        const reminder = await client.getReminder(alertToken);
        applyReminderUpdate(reminder, message);
        await client.updateReminder(alertToken, reminder);
        console.log(`Reminder message update complete: alertToken=...${alertToken.slice(-8)}`);
        return handlerInput.responseBuilder.getResponse();
      }

      console.error(`Unsupported reminder message operation: ${operation}`);
    } catch (err) {
      console.error(`Reminder message ${operation} failed:`, err.message);
    }

    return handlerInput.responseBuilder.getResponse();
  },
};

function applyReminderUpdate(reminder, message) {
  const minutesBefore = message.minutesBefore || REMINDER_MINUTES_BEFORE;
  if (message.scheduledTime) {
    reminder.trigger.scheduledTime = message.scheduledTime;
  }
  if (message.timezone) {
    reminder.trigger.timeZoneId = message.timezone;
  }
  if (message.summary) {
    reminder.alertInfo.spokenInfo.content[0].text =
      buildReminderText(message.summary, minutesBefore);
  }
}

module.exports = MessageReceivedHandler;
