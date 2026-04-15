function normalizeMinutes(minutes) {
  const parsed = Number(minutes);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function pickGoogleReminderMinutes(reminders) {
  if (!Array.isArray(reminders) || reminders.length === 0) return null;

  const candidates = reminders
    .map(reminder => normalizeMinutes(reminder && reminder.minutes))
    .filter(minutes => minutes !== null);

  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

function getReminderMinutesBefore(event, fallbackMinutes = 10) {
  const overrideMinutes = pickGoogleReminderMinutes(event && event.reminders && event.reminders.overrides);
  if (overrideMinutes !== null) return overrideMinutes;

  if (event && event.reminders && event.reminders.useDefault !== false) {
    const defaultMinutes = pickGoogleReminderMinutes(event.calendarDefaultReminders);
    if (defaultMinutes !== null) return defaultMinutes;
  }

  return normalizeMinutes(fallbackMinutes) ?? 10;
}

module.exports = { getReminderMinutesBefore };
