# Architecture

For diagrams and a full end-to-end walkthrough, see
[`docs/visual-architecture.md`](visual-architecture.md).

## Goal

Nudge turns Google Calendar events into spoken Alexa Reminders with as little
manual work as Amazon's APIs allow.

---

## Current Architecture

```
User says "sync my calendar"
        ↓
AlexaAnnouncer creates real spoken Alexa Reminders
        ↓
DynamoDB stores Google event -> Alexa alertToken mappings
        ↓
Google Calendar webhook calls NudgeCalendarSync when events change
        ↓
NudgeCalendarSync uses Alexa Skill Messaging to ask AlexaAnnouncer
to update/delete existing Alexa Reminders by alertToken
```

---

## Dev Architecture (Phase 2–3)

Used while building and testing. No Amazon certification required.

```
User: "Alexa, sync my calendar"
        ↓
Lambda — Skill Handler
  - reads Google Calendar (via OAuth access token from session)
  - creates Alexa Reminders for each upcoming event
        ↓
Reminders fire automatically at the right time
Echo announces the event
```

**Limitation:** User must say "sync" to refresh spoken Alexa Reminders after
calendar changes. The skill can create reminders for a configurable future
window, defaulting to 7 days, so users do not need to sync every day unless they
change near-term calendar events.
This phase is for getting OAuth + Calendar + Reminders working end-to-end.

---

## Components

### Alexa Skill (skill-package/)
- Interaction model: Launch, Sync, NextEvent, Help, Stop
- Permissions: `alexa::alerts:reminders:skill:readwrite`
- Account linking: Google OAuth 2.0

### Lambda — Skill Handler (lambda/)
- Handles all Alexa intent requests
- Uses Google access token from Alexa session to read calendar
- Creates Alexa reminders (Phase 3) or triggers proactive events (Phase 4+)

### Lambda — Poller (Phase 4)
- Optional backup notification path; not the core spoken-reminder path
- Can be triggered by EventBridge every minute when due-time Proactive Events are enabled
- Queries `DUE#YYYY-MM-DDTHH:mmZ` records from DynamoDB
- Checks user settings and dedupe state before sending
- Calls Alexa Proactive Events API

### Lambda — Calendar Sync (Phase 7 prep)
- Handles Google Calendar watch setup, webhook notifications, and reconciliation
- Refreshes Google access tokens using stored refresh tokens
- Runs full sync or incremental sync for the changed user/calendar only
- Writes due-time event records into DynamoDB

### DynamoDB (Phase 5)
- Table: `NudgeUsers`
- Key: `pk` and `sk`
- Stores: user settings, Google refresh token, calendar sync state, watch-channel lookups, due-time event records, announced event keys

### EventBridge (Phase 4)
- Optional Proactive Events due checker rule: `rate(1 minute)`
- Target: Poller Lambda

---

## Auth Flows

### Google OAuth (Account Linking)
- Configured in Alexa developer console
- User links Google account in the Alexa app
- Alexa handles token refresh automatically before each skill session
- Access token available at `handlerInput.context.System.user.accessToken`
- **For Phase 4 (out-of-session polling):** store Google refresh token in DynamoDB on first skill launch

### Alexa Skill Messaging
- Used by `NudgeCalendarSync` to deliver out-of-session work to the skill.
- This is how background Google Calendar changes reach `AlexaAnnouncer` after
  the user is no longer in a voice session.
- `AlexaAnnouncer` receives `Messaging.MessageReceived`, then uses the Alexa
  Reminders API to update/delete an existing reminder by `alertToken`.

### Alexa Proactive Events API
- Used only for Alexa notifications, not the core spoken reminder path.
- Current use: rate-limited sync nudges when a brand-new Google event has no
  existing `alertToken` and therefore needs the user to say "sync my calendar."
- Optional use: backup due-time notifications through `NudgePoller`, which can
  stay disabled for the voice-reminder-first product.
- **Certification note:** development works for your own account, but publishing
  Proactive Events requires Amazon review and notification permission.

---

## Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| Cloud provider | AWS | Native Alexa/Lambda integration, always-free tier, one ecosystem |
| Proactive mechanism | Reminders API (dev) → Proactive Events API (prod) | Reminders need no certification; Proactive Events is the right long-term path |
| Scheduling | EventBridge rate (1 min) | Due checker queries one due-time bucket per minute |
| Calendar sync | Google push + incremental sync | Webhook maps each notification to one user/calendar, then updates DynamoDB due records |
| User storage | DynamoDB | Serverless, free tier, native AWS |

---

## Future Push-Based Sync

The publish-scale sync path is:

```
Google Calendar watch notification
        ↓
Webhook Lambda
        ↓
Calendar incremental sync
        ↓
DynamoDB next-events cache
        ↓
Minute poller checks DynamoDB only
```

Google push notifications indicate that a calendar changed; they don't include the full event data. The webhook still needs to call Google Calendar, store the updated event cache, and renew Google watch channels before they expire.

Due announcements are stored in event records keyed by reminder minute:

```
PK = dueMinute#2026-04-06T14:05Z
SK = userId#calendarId#eventId
```

Then the minute poller queries one due-time bucket instead of scanning all users. User settings stay keyed by `USER#userId`, and Google push/incremental sync upserts/deletes these due-time event records whenever calendar data changes.

---

## Certification Requirements

To publish on the Alexa skill store:
- Alexa skill review (Amazon) — functional + content review
- Google OAuth app verification — required when app has real users accessing Calendar API
- Proactive Events API permission — approved during Alexa certification
- Users must grant the skill notification/reminder permissions in the Alexa app
- Proactive Events use predefined notification schemas and live skills have customer notification limits

None of these block development or personal use.
