/**
 * Nudge — Lambda entry point
 *
 * The Alexa SDK routes incoming requests to the first handler
 * whose canHandle() returns true, in order. ErrorHandler is always last.
 */

const Alexa = require('ask-sdk-core');

const RefreshCalendarTaskHandler = require('./handlers/RefreshCalendarTaskHandler');
const LaunchHandler = require('./handlers/LaunchHandler');
const SyncCalendarHandler = require('./handlers/SyncCalendarHandler');
const NextEventHandler = require('./handlers/NextEventHandler');
const DisableHandler = require('./handlers/DisableHandler');
const DeleteDataHandler = require('./handlers/DeleteDataHandler');
const CalendarSelectHandler = require('./handlers/CalendarSelectHandler');
const SetReminderWindowHandler = require('./handlers/SetReminderWindowHandler');
const HelpHandler = require('./handlers/HelpHandler');
const StopHandler = require('./handlers/StopHandler');
const SessionEndedHandler = require('./handlers/SessionEndedHandler');
const MessageReceivedHandler = require('./handlers/MessageReceivedHandler');
const ErrorHandler = require('./handlers/ErrorHandler');

const skill = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    RefreshCalendarTaskHandler,
    LaunchHandler,
    SyncCalendarHandler,
    NextEventHandler,
    DisableHandler,
    DeleteDataHandler,
    CalendarSelectHandler,
    SetReminderWindowHandler,
    HelpHandler,
    StopHandler,
    SessionEndedHandler,
    MessageReceivedHandler
  )
  .addErrorHandlers(ErrorHandler)
  .withApiClient(new Alexa.DefaultApiClient())
  .create();

exports.handler = async (event, context) => {
  return skill.invoke(event, context);
};
