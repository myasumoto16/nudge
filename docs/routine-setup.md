# Routine Setup Guide

Use this setup if you want Nudge to refresh reminders automatically without
manually asking each time.

## What To Build

Create one Alexa routine that runs this command on an Echo device:

```text
ask nudge to run quiet sync
```

Recommended device:

- the Echo speaker itself
- not the Alexa phone app

## Recommended Schedule

Use one routine with five refreshes during the day and evening:

- first refresh: `7:00 AM`
- second refresh: `11:00 AM`
- third refresh: `3:00 PM`
- fourth refresh: `7:00 PM`
- fifth refresh: `11:00 PM`

This gives daytime coverage for new events plus an evening refresh for events
planned later in the day, without asking the user to create multiple separate
routines.

## Suggested Routine Shape

1. Trigger: 7:00 AM
2. Action: `ask nudge to run quiet sync`
3. Wait: 4 hours
4. Action: `ask nudge to run quiet sync`
5. Wait: 4 hours
6. Action: `ask nudge to run quiet sync`
7. Wait: 4 hours
8. Action: `ask nudge to run quiet sync`
9. Wait: 4 hours
10. Action: `ask nudge to run quiet sync`
11. Device: Echo

## What You Should See

- new calendar events get picked up on the next routine run
- existing reminders update when Google Calendar changes
- deleted or silent events remove reminders
- successful routine sync is silent

## Troubleshooting

- If the routine says the long verbose response, use the exact phrase
  `ask nudge to run quiet sync`.
- If reminders do not update, confirm the routine is running on the Echo device
  and not the phone app.
- If Alexa says the skill had a problem, run the command once manually:
  `Alexa, ask nudge to sync my calendar`
- If a reminder seems missing, wait a minute and run the routine again.
- If the Echo device seems unreachable, try again from the device itself.

## Notes

- This setup is the current routine-first path for Nudge.
- It is designed to be automatic after one-time setup.
- Keep this as one simple routine instead of several separate routines.
