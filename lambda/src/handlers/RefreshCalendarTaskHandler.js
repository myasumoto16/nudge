const { runCalendarReminderSync } = require('../services/calendarReminderSync');

const TASK_NAME = 'RefreshCalendar';

function taskDirective(code, message) {
  return {
    type: 'Tasks.CompleteTask',
    status: {
      code: String(code),
      message,
    },
  };
}

const RefreshCalendarTaskHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    return (
      request.type === 'LaunchRequest' &&
      request.task &&
      request.task.name === TASK_NAME
    );
  },

  async handle(handlerInput) {
    const { context } = handlerInput.requestEnvelope;
    const syncOutcome = await runCalendarReminderSync({
      userId: context.System.user.userId,
      deviceId: context.System.device.deviceId,
      accessToken: context.System.user.accessToken,
      apiAccessToken: context.System.apiAccessToken,
      apiEndpoint: context.System.apiEndpoint,
      quietSync: true,
    });

    if (syncOutcome.code === 'skipped') {
      return handlerInput.responseBuilder
        .addDirective(taskDirective(200, 'Calendar refresh skipped because a recent sync already ran.'))
        .withShouldEndSession(true)
        .getResponse();
    }

    if (syncOutcome.ok) {
      const message = syncOutcome.result.failed > 0
        ? 'Calendar refresh finished, but some reminders may need another sync.'
        : 'Calendar refresh completed successfully.';
      return handlerInput.responseBuilder
        .addDirective(taskDirective(200, message))
        .withShouldEndSession(true)
        .getResponse();
    }

    const status = {
      google_link_required: [403, 'Google account linking is required before this task can run.'],
      calendar_read_error: [500, 'Calendar refresh could not read Google Calendar.'],
      reminders_permission_required: [403, 'Reminders permission is required before this task can run.'],
      device_not_reachable: [500, 'The Alexa device could not be reached for reminder updates.'],
      reminders_temporarily_unavailable: [500, 'Alexa reminders are temporarily unavailable.'],
      sync_start_failed: [500, 'Calendar refresh could not start.'],
      reminders_error: [500, 'Calendar refresh could not update reminders.'],
    }[syncOutcome.code] || [500, 'Calendar refresh failed.'];

    return handlerInput.responseBuilder
      .addDirective(taskDirective(status[0], status[1]))
      .withShouldEndSession(true)
      .getResponse();
  },
};

module.exports = RefreshCalendarTaskHandler;
