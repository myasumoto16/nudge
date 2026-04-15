# Support

## What Nudge Does

Nudge turns Google Calendar events into Alexa reminders and keeps those
reminders aligned when calendar events change.

## Getting Started

1. Enable the skill in the Alexa app.
2. Link the Google account that owns the calendar.
3. Say:

   ```text
   Alexa, ask nudge to sync my calendar
   ```

4. For automatic refresh after setup, create one Alexa routine on the Echo
   device with this structure:

   ```text
   7:00 AM
   ask nudge to run quiet sync
   wait 4 hours
   ask nudge to run quiet sync
   wait 4 hours
   ask nudge to run quiet sync
   wait 4 hours
   ask nudge to run quiet sync
   wait 4 hours
   ask nudge to run quiet sync
   ```

## Recommended Routine Setup

- one routine, not several separate routines
- trigger: `7:00 AM`
- device: Echo device, not phone
- action sequence:
  - `ask nudge to run quiet sync`
  - wait `4 hours`
  - `ask nudge to run quiet sync`
  - wait `4 hours`
  - `ask nudge to run quiet sync`
  - wait `4 hours`
  - `ask nudge to run quiet sync`
  - wait `4 hours`
  - `ask nudge to run quiet sync`
- keep the routine simple; avoid extra volume or custom-command experiments

## What To Expect

- existing reminders update when calendar events move or change
- deleted events remove their reminders
- new events are picked up on the next manual sync or routine run
- reminders are delivered by Alexa
- you can say `delete my data` to remove Nudge-owned sync data and reminder mappings

## Troubleshooting

### Reminders did not appear

- run `Alexa, ask nudge to sync my calendar`
- confirm the linked Google account owns or can fully read the calendar
- confirm the event is not all-day, cancelled, free, or marked `#silent`

### Routine did not refresh reminders

- confirm the routine runs on an Echo device
- use the exact command in each refresh step:

  ```text
  ask nudge to run quiet sync
  ```

- if Alexa reminder services appear temporarily unavailable, wait a minute and
  try again

### A reminder time did not match the event

- run a manual sync once
- confirm the event change has already synced into Google Calendar

### Remove my data

- say:

  ```text
  Alexa, ask nudge to delete my data
  ```

- this removes Nudge-owned sync records, calendar watch metadata, and reminder mappings
- if you also want to revoke Google account access, unlink Nudge or disable the skill in the Alexa app

## Data and Privacy

See the privacy policy for data use, retention, and deletion details.

## Contact

Support: https://masakazuyasumoto.com/projects/nudge/support

Email: yasumotom98@gmail.com
