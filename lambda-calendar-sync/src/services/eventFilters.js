function shouldAnnounceEvent(event) {
  const text = `${event.summary || ''}\n${event.description || ''}`.toLowerCase();

  if (event.status === 'cancelled') return false;
  if (!event.start || !event.start.dateTime) return false;
  if (event.transparency === 'transparent') return false;
  if (text.includes('#silent') || text.includes('[silent]')) return false;

  return true;
}

function normalizeEvent(event, calendarId, calendarDefaultReminders = []) {
  if (!event.start || (!event.start.dateTime && !event.start.date)) return null;

  return {
    id: event.id,
    calendarId,
    summary: event.summary || 'Untitled event',
    description: event.description || '',
    status: event.status || 'confirmed',
    transparency: event.transparency || 'opaque',
    timezone: event.start.timeZone || 'UTC',
    reminders: event.reminders || { useDefault: true },
    calendarDefaultReminders,
    startTime: event.start.dateTime
      ? new Date(event.start.dateTime)
      : new Date(event.start.date),
    isAllDay: !event.start.dateTime,
  };
}

module.exports = { normalizeEvent, shouldAnnounceEvent };
