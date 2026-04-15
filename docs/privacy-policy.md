# Privacy Policy

Last updated: 2026-04-09

## Summary

Nudge uses Google Calendar data and Alexa account data only to create and keep
Alexa reminders aligned with a user's calendar events.

## Information We Access

Nudge may access:

- Google account information needed for account linking
- Google Calendar event data needed to create or maintain reminders
- calendar IDs selected by the user
- reminder timing preferences
- Alexa user identifier and skill-related account context
- Alexa reminder mapping metadata, including reminder tokens needed for updates

## Information We Store

Nudge may store:

- linked account state
- Google refresh token and related account-link metadata
- selected calendars and user reminder settings
- reminder mappings and sync state
- Google Calendar watch-channel metadata used for push updates

## How We Use Information

Nudge uses this information only to:

- create Alexa reminders from Google Calendar events
- update or delete existing reminders when calendar events change
- avoid duplicate reminders during sync
- maintain Google Calendar watch subscriptions and sync state
- provide account unlinking and support operations

## What We Do Not Do

Nudge does not:

- sell personal data
- use calendar data for advertising
- use calendar data for profiling unrelated to the skill
- access calendars outside the permissions granted by the user

## Data Retention

Nudge retains data only as long as needed to operate the skill, maintain sync
state, and support account unlinking or deletion requests.

If a user says "delete my data" while the skill is enabled, Nudge removes stored
linked-account sync data, calendar watch metadata, reminder mappings, and other
Nudge-owned records from its AWS storage.

Disabling reminders is different from deleting data. A pause or disable command
stops reminders, but it does not mean the Google account is unlinked in Alexa.
To fully revoke Google account access, the user should also unlink Nudge or
disable the skill in the Alexa app.

## User Choices

Users can:

- disable the skill in the Alexa app
- unlink the connected Google account
- say "Alexa, ask nudge to delete my data" while the skill is enabled
- delete Alexa reminders through Alexa
- contact support to request deletion of stored account data

## Security

Nudge uses AWS-managed infrastructure and stores only the data needed to operate
calendar sync and reminder maintenance. Google refresh tokens are stored in
encrypted form. Access should be limited to the minimum required operational
services and administrators.

## Contact

Support: https://masakazuyasumoto.com/projects/nudge/support

Email: yasumotom98@gmail.com
