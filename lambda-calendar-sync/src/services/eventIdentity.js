function eventIdentityKey(event) {
  return `${event.calendarId}:${event.id}`;
}

function reminderMappingSortKey(eventKey) {
  return `REMINDER#${encodeURIComponent(eventKey)}`;
}

module.exports = {
  eventIdentityKey,
  reminderMappingSortKey,
};
