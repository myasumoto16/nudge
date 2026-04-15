/**
 * Calendar event filters used by session-created Reminders.
 *
 * The poller has the same defaults: skip all-day, cancelled, free, and #silent
 * events. DynamoDB-backed include/exclude tags are applied when available.
 */

function shouldAnnounceEvent(event, settings = {}) {
  const text = `${event.summary || ''}\n${event.description || ''}`.toLowerCase();

  if (event.isAllDay) return false;
  if (event.status === 'cancelled') return false;
  if (event.transparency === 'transparent') return false;
  if (text.includes('#silent') || text.includes('[silent]')) return false;

  const includeTags = settings.includeTags || [];
  if (includeTags.length > 0) {
    return includeTags.some(tag => text.includes(String(tag).toLowerCase()));
  }

  const excludeTags = settings.excludeTags || [];
  if (excludeTags.some(tag => text.includes(String(tag).toLowerCase()))) {
    return false;
  }

  return true;
}

module.exports = { shouldAnnounceEvent };
