# Deployment Checklist

This checklist covers the external AWS, Alexa, and Google setup needed for the
current reminder-first, routine-first architecture.

## AWS

### 1. Create DynamoDB Table

Create table: `NudgeUsers`

Required key schema:

- Partition key: `pk` string
- Sort key: `sk` string

Recommended settings:

- Enable server-side encryption.
- Enable TTL on attribute: `expiresAt`.

Important: this replaces the older `userId`-only table shape. The push-sync code expects `pk` and `sk`.

### 2. Deploy Lambdas

Deploy four Lambdas:

- `AlexaAnnouncer` from `lambda/`
- `NudgeTokenProxy` from `lambda-token-proxy/`
- `NudgePoller` from `lambda-poller/`
- `NudgeCalendarSync` from `lambda-calendar-sync/`

### 3. Configure Skill Lambda

Set environment variables on `AlexaAnnouncer`:

```text
DYNAMODB_TABLE_NAME=NudgeUsers
AWS_REGION=us-east-1
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
CALENDAR_SYNC_FUNCTION_NAME=NudgeCalendarSync
```

IAM permissions:

- DynamoDB access to `NudgeUsers`
- `lambda:InvokeFunction` for `NudgeCalendarSync`
- CloudWatch Logs

### 4. Configure Token Proxy Lambda

Set environment variables on `NudgeTokenProxy`:

```text
DYNAMODB_TABLE_NAME=NudgeUsers
AWS_REGION=us-east-1
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_TOKEN_ENCRYPTION_KEY_BASE64=...
```

IAM permissions:

- DynamoDB `UpdateItem` on `NudgeUsers`
- CloudWatch Logs

### 5. Configure Poller Lambda

This is optional. Configure it only if you want backup Proactive Events
notifications in addition to spoken Alexa Reminders.

Set environment variables on `NudgePoller`:

```text
DYNAMODB_TABLE_NAME=NudgeUsers
AWS_REGION=us-east-1
LWA_CLIENT_ID=...
LWA_CLIENT_SECRET=...
DUE_GRACE_MINUTES=2
PROACTIVE_EVENTS_PATH=/v1/proactiveEvents/stages/development
```

IAM permissions:

- DynamoDB `Query`
- DynamoDB `GetItem`
- DynamoDB `UpdateItem`
- DynamoDB `DeleteItem`
- CloudWatch Logs

### 6. Configure Calendar Sync Lambda

Set environment variables on `NudgeCalendarSync`:

```text
DYNAMODB_TABLE_NAME=NudgeUsers
AWS_REGION=us-east-1
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_TOKEN_ENCRYPTION_KEY_BASE64=...
LWA_CLIENT_ID=...
LWA_CLIENT_SECRET=...
GOOGLE_WEBHOOK_URL=https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/google/calendar/webhook
SYNC_LOOKAHEAD_HOURS=48
WATCH_TTL_SECONDS=604800
WATCH_RENEWAL_HOURS=24
SYNC_NUDGE_INTERVAL_HOURS=24
```

Use the Alexa Skill Messaging client ID/secret for `LWA_CLIENT_ID` and
`LWA_CLIENT_SECRET`. `NudgeCalendarSync` needs them to request out-of-session
update/delete of existing Alexa Reminders by `alertToken`.

IAM permissions:

- DynamoDB `GetItem`
- DynamoDB `PutItem`
- DynamoDB `UpdateItem`
- DynamoDB `DeleteItem`
- DynamoDB `Scan`
- CloudWatch Logs

### 7. Create API Gateway Routes

Create HTTP API routes:

```text
POST /token -> NudgeTokenProxy
POST /google/calendar/webhook -> NudgeCalendarSync
```

Use the `/token` URL as the Alexa account-linking token endpoint.

Use the `/google/calendar/webhook` URL as `GOOGLE_WEBHOOK_URL` for Google Calendar watch notifications.

### 8. Create EventBridge Rules

Create:

```text
rate(1 hour) -> NudgeCalendarSync
```

`NudgeCalendarSync` renews Google watch channels and reconciles missed webhook changes.

Keep `rate(1 minute) -> NudgePoller` disabled unless you explicitly want backup
due-time notifications.

## Alexa Developer Console

### 1. Account Linking

Set:

```text
Authorization URL:
https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&prompt=consent

Token URL:
https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/token
```

Scopes:

```text
https://www.googleapis.com/auth/calendar.readonly
openid
email
```

### 2. Permissions

Enable:

- Reminders permission.

### 3. Skill Manifest

Make sure the skill package has the production values instead of placeholders:

- Lambda ARN for `AlexaAnnouncer`
- Token proxy URL for account linking
- Google OAuth client ID

### 4. Device/App Test Requirement

In the Alexa app, enable Notifications for the skill. Proactive Events are delivered through Alexa Notifications, not the same exact channel as Reminders.

Test on a real Echo before optimizing further, because the device behavior may be subtler than the manual Reminder speech.

## Google Cloud Console

### 1. APIs

Enable:

- Google Calendar API

### 2. OAuth Client

Use a Web Application OAuth client.

Add the Alexa redirect URI from the Alexa Developer Console.

Make sure the requested scopes match:

```text
https://www.googleapis.com/auth/calendar.readonly
openid
email
```

### 3. Webhook Domain

Use the API Gateway `/google/calendar/webhook` URL for Google Calendar watch notifications.

If Google requires domain verification for your webhook domain, verify the API Gateway/custom domain in Google Search Console or move the webhook behind a verified custom domain.

## Test Order

1. Link the Google account in the Alexa app.
2. Say: "Alexa, open Nudge."
3. Check DynamoDB for the user settings record:

   ```text
   pk = USER#...
   sk = SETTINGS
   ```

4. Confirm the temporary Google token record is consumed/deleted after launch:

   ```text
   pk = GOOGLE#...
   sk = TOKEN
   ```

5. Confirm calendar sync records exist:

   ```text
   pk = USER#...
   sk = CALENDAR#primary
   ```

6. Confirm watch records exist:

   ```text
   pk = WATCH#...
   sk = META
   ```

7. Add a Google Calendar event more than 10 minutes in the future.
8. Confirm Google webhook invokes `NudgeCalendarSync`.
9. Confirm a spoken reminder mapping is written:

   ```text
   pk = USER#...
   sk = REMINDER#...
   ```

10. If you kept `NudgePoller` enabled, let it run at the due minute.
11. Confirm the Echo receives the Alexa notification.

## Event Control

To skip a specific event, put either of these in the Google Calendar event title or description:

```text
#silent
[silent]
```

Nudge skips all-day, cancelled, and free/transparent events by default.

## Certification Notes

Publishing requires more than development testing:

- Google OAuth app verification for Calendar readonly access.
- Alexa skill certification.
- Proactive Events permission approval only if you keep the backup poller.
- Privacy policy describing Calendar data access, token storage, settings storage, and deletion behavior.
- A way for users to disable reminders/announcements and request data deletion.

## Google OAuth Verification Plan

The "Google hasn't verified this app" warning is expected during development. Before beta or public launch:

1. In Google Cloud Console → OAuth consent screen, complete app metadata:
   - App name
   - Support email
   - Developer contact email
   - App home page, if required
   - Privacy policy URL
2. Keep scopes minimal:
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `openid` only if still needed for Google `sub`
   - Avoid Google `email` unless the implementation truly needs it
3. Add yourself and any early testers as **Test users** while the app is unverified.
4. Write the scope justification:
   - Nudge reads Google Calendar event titles, times, descriptions, and status only to create Echo reminder notifications.
   - Nudge does not write calendar events.
5. Document data handling:
   - Stores Google refresh token or encrypted secret reference
   - Stores selected calendars and reminder preferences
   - Stores pending due-event reminder metadata
   - Allows users to disable announcements and request deletion
6. Submit OAuth verification before inviting non-test users.
