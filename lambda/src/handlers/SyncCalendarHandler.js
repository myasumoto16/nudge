/**
 * SyncCalendarIntent — the core action.
 *
 * Reads Google Calendar events for the configured lookahead window and creates an Alexa
 * reminder for each one, firing X minutes before start time.
 * Clears stale reminders first to handle moved/cancelled events.
 */

const { runCalendarReminderSync } = require('../services/calendarReminderSync');
const config = require('../config');

const QUIET_SYNC_INTENTS = new Set(['QuickSyncIntent']);

const SyncCalendarHandler = {
  canHandle(handlerInput) {
    return (
      handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
      ['SyncCalendarIntent', 'QuickSyncIntent'].includes(handlerInput.requestEnvelope.request.intent.name)
    );
  },

  async handle(handlerInput) {
    const intentName = handlerInput.requestEnvelope.request.intent.name;
    const quietSync = QUIET_SYNC_INTENTS.has(intentName);
    const { context } = handlerInput.requestEnvelope;
    const accessToken = context.System.user.accessToken;

    if (!accessToken) {
      const responseBuilder = handlerInput.responseBuilder
        .speak(
          quietSync
            ? "Please link your Google Calendar first."
            : "Please link your Google Calendar in the Alexa app before syncing reminders."
        );
      responseBuilder.withLinkAccountCard();
      return responseBuilder.getResponse();
    }

    const userId = context.System.user.userId;
    const syncOutcome = await runCalendarReminderSync({
      userId,
      deviceId: context.System.device.deviceId,
      accessToken,
      apiAccessToken: context.System.apiAccessToken,
      apiEndpoint: context.System.apiEndpoint,
      quietSync,
      calendarIdsOverride: handlerInput.attributesManager.getSessionAttributes().calendarIds,
    });

    if (syncOutcome.code === 'skipped') {
      if (quietSync) {
        return handlerInput.responseBuilder.getResponse();
      }

      const message = syncOutcome.reason === 'in_flight'
        ? 'Your calendar sync is already running.'
        : 'Your calendar was just synced. Try again in a minute.';
      return handlerInput.responseBuilder
        .speak(message)
        .getResponse();
    }

    if (!syncOutcome.ok) {
      if (syncOutcome.code === 'google_link_required') {
        const responseBuilder = handlerInput.responseBuilder
          .speak(
            quietSync
              ? "Please link your Google Calendar first."
              : "Please link your Google Calendar in the Alexa app before syncing reminders."
          );
        responseBuilder.withLinkAccountCard();
        return responseBuilder.getResponse();
      }

      if (syncOutcome.code === 'sync_start_failed') {
        return handlerInput.responseBuilder
          .speak(
            quietSync
              ? "I couldn't start a refresh right now."
              : "I couldn't start your calendar sync right now. Please try again in a minute."
          )
          .getResponse();
      }

      if (syncOutcome.code === 'calendar_read_error') {
        return handlerInput.responseBuilder
          .speak(
            quietSync
              ? "I couldn't read your Google Calendar right now."
              : "I couldn't read your Google Calendar. Please check that your account is still linked and try again."
          )
          .getResponse();
      }

      if (syncOutcome.code === 'reminders_permission_required') {
        return handlerInput.responseBuilder
          .speak(
            quietSync
              ? "I need Alexa reminders permission first."
              : "I need Alexa reminders permission before I can create reminders. Open the Alexa app, go to Nudge settings, and enable Reminders."
          )
          .getResponse();
      }

      if (syncOutcome.code === 'device_not_reachable') {
        return handlerInput.responseBuilder
          .speak(
            quietSync
              ? "I couldn't reach this Alexa device right now."
              : "I couldn't reach this Alexa device to set reminders. Please try again from your Echo device in a minute."
          )
          .getResponse();
      }

      if (syncOutcome.code === 'reminders_temporarily_unavailable') {
        return handlerInput.responseBuilder
          .speak(
            quietSync
              ? "Alexa reminders are temporarily unavailable."
              : "Alexa reminders are temporarily unavailable right now. Please try again in a minute."
          )
          .getResponse();
      }

      return handlerInput.responseBuilder
        .speak(quietSync ? "Something went wrong." : "Something went wrong setting up your reminders. Please try again.")
        .getResponse();
    }
    const { events, result } = syncOutcome;

    if (quietSync) {
      if (result.failed > 0) {
        return handlerInput.responseBuilder
          .speak("Some reminders may need another sync.")
          .getResponse();
      }

      return handlerInput.responseBuilder
        .getResponse();
    }

    let speech;
    if (events.length === 0) {
      speech = `Done. You have no upcoming events in the next ${config.SYNC_LOOKAHEAD_HOURS} hours.`;
    } else if (result.created === 0 && result.deleted === 0 && result.updated === 0 && result.failed === 0) {
      speech = result.covered > 0
        ? "Done. Your reminders are already up to date."
        : "Done. Your reminders already match your calendar.";
    } else {
      speech = result.failed > 0
        ? "Done, but some reminders may need another sync."
        : "Done. I updated your reminders.";
    }

    if (result.created > 0) {
      speech += " For new calendar events later, say, ask nudge to sync my calendar.";
    }

    return handlerInput.responseBuilder
      .speak(speech)
      .getResponse();
  },
};

module.exports = SyncCalendarHandler;
