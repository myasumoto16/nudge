const config = require('../config');

function truncateName(name, maxLen = 100) {
  return name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name;
}

function normalizeMinutes(minutes) {
  const parsed = Number(minutes);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function getReminderMinutesBefore(event, fallbackMinutes = config.REMINDER_MINUTES_BEFORE) {
  const overrideMinutes = pickGoogleReminderMinutes(event && event.reminders && event.reminders.overrides);
  if (overrideMinutes !== null) return overrideMinutes;

  if (event && event.reminders && event.reminders.useDefault !== false) {
    const defaultMinutes = pickGoogleReminderMinutes(event.calendarDefaultReminders);
    if (defaultMinutes !== null) return defaultMinutes;
  }

  return normalizeMinutes(fallbackMinutes) ?? config.REMINDER_MINUTES_BEFORE;
}

function pickGoogleReminderMinutes(reminders) {
  if (!Array.isArray(reminders) || reminders.length === 0) return null;

  const candidates = reminders
    .map(reminder => normalizeMinutes(reminder && reminder.minutes))
    .filter(minutes => minutes !== null);

  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

function buildReminderText(eventSummary, minutesBefore) {
  const safeSummary = truncateName(eventSummary);
  const normalizedMinutes = normalizeMinutes(minutesBefore) ?? config.REMINDER_MINUTES_BEFORE;

  if (normalizedMinutes <= 0) {
    return `${safeSummary} now.`;
  }

  if (normalizedMinutes === 1) {
    return `${safeSummary} in 1 minute.`;
  }

  return `${safeSummary} in ${normalizedMinutes} minutes.`;
}

module.exports = {
  buildReminderText,
  getReminderMinutesBefore,
  truncateName,
};
