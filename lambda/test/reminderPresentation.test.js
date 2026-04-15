const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildReminderText,
  getReminderMinutesBefore,
} = require('../src/services/reminderPresentation');

test('event override reminder timing wins over defaults and fallback', () => {
  const event = {
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 },
        { method: 'popup', minutes: 5 },
      ],
    },
    calendarDefaultReminders: [
      { method: 'popup', minutes: 10 },
    ],
  };

  assert.equal(getReminderMinutesBefore(event, 15), 5);
});

test('calendar default reminder timing is used when event uses defaults', () => {
  const event = {
    reminders: {
      useDefault: true,
    },
    calendarDefaultReminders: [
      { method: 'popup', minutes: 60 },
      { method: 'popup', minutes: 10 },
    ],
  };

  assert.equal(getReminderMinutesBefore(event, 15), 10);
});

test('fallback reminder timing is used when Google reminder timing is absent', () => {
  const event = {
    reminders: {
      useDefault: true,
    },
    calendarDefaultReminders: [],
  };

  assert.equal(getReminderMinutesBefore(event, 15), 15);
});

test('zero-minute reminder text says now', () => {
  assert.equal(buildReminderText('Take clonidine', 0), 'Take clonidine now.');
});

test('minute reminder text is singular at one minute', () => {
  assert.equal(buildReminderText('Stretch', 1), 'Stretch in 1 minute.');
});
