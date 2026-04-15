# Setup Guide

For the full deployment checklist, see `docs/deployment-checklist.md`.

## Prerequisites

- AWS account
- Amazon Developer account (developer.amazon.com) — free
- Google Cloud Console account — free
- Node.js 18+
- Optional: ASK CLI, only if you want to deploy the Alexa skill package from this repo instead of using the Alexa Developer Console UI

---

## Step 1 — AWS Setup

Use the AWS Console UI for now. AWS CLI is optional, but useful later for
repeatable deploys.

1. Sign in to the AWS Console.
2. Note your AWS Account ID.
3. Follow `docs/deployment-checklist.md` to create:
   - the DynamoDB table
   - the Lambda functions
   - the API Gateway routes
   - the EventBridge rule for watch renewal
4. Keep `NudgePoller` disabled unless you want backup due-time notifications.

Optional CLI path:

1. Create an IAM user or role with the permissions needed for Lambda, IAM,
   DynamoDB, API Gateway, and EventBridge.
2. Install/configure the AWS CLI:

   ```bash
   aws configure
   ```

3. Use the CLI commands in later sections as a starting point.

---

## Step 2 — Alexa Skill Setup

Use the Alexa Developer Console UI for now. ASK CLI is optional.

If you want repeatable repo-driven skill deploys later, install and configure ASK CLI:

```bash
npm install -g ask-cli
ask configure
```

If you use the UI, manually mirror the settings from:

- `skill-package/skill.json`
- `skill-package/interactionModels/custom/en-US.json`

---

## Step 3 — Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project: **AlexaAnnouncer**
3. Enable the **Google Calendar API**
4. Go to **APIs & Services → Credentials**
5. Create **OAuth 2.0 Client ID** → type: **Web application**
6. Add authorized redirect URI:
   ```
   https://layla.amazon.com/api/skill/link/YOUR_SKILL_VENDOR_ID
   ```
   (You'll get the exact URI from the Alexa developer console in Step 5)
7. Copy your **Client ID** and **Client Secret**

---

## Step 4 — Deploy Lambdas

You can deploy Lambdas through the AWS Console UI by uploading zip files. The
current reminder-first architecture uses four Lambdas, all listed in
`docs/deployment-checklist.md`.

```bash
cd lambda
npm install
# Zip and deploy
zip -r ../skill.zip . -x '*.zip' -x '.env' -x 'node_modules/.cache/*'
aws lambda create-function \
  --function-name AlexaAnnouncer \
  --runtime nodejs18.x \
  --role arn:aws:iam::ACCOUNT_ID:role/lambda-basic-execution \
  --handler src/index.handler \
  --zip-file fileb://../skill.zip

# Set environment variables
aws lambda update-function-configuration \
  --function-name AlexaAnnouncer \
  --environment "Variables={GOOGLE_CLIENT_ID=xxx,GOOGLE_CLIENT_SECRET=xxx,REMINDER_MINUTES_BEFORE=10}"
```

---

## Step 5 — Alexa Developer Console

1. Go to [developer.amazon.com/alexa/console/ask](https://developer.amazon.com/alexa/console/ask)
2. **Create Skill** → Custom → Alexa-hosted (No) → use your Lambda ARN
3. Configure the invocation name and intents from `skill-package/interactionModels/custom/en-US.json`
4. Configure the endpoint ARN for `AlexaAnnouncer`
5. In the Alexa console → **Account Linking**:
   - Authorization URI: `https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&prompt=consent`
   - Access Token URI: use your token proxy API Gateway URL, for example `https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/token`
   - Client ID / Secret: from Google Cloud Console
   - Scopes: `https://www.googleapis.com/auth/calendar.readonly email openid`
   - Copy the **Redirect URL** shown → paste it back into Google Cloud Console (Step 3.6)

6. In the Alexa console → **Permissions**:
   - Enable **Reminders**

If you choose to use ASK CLI instead of the UI, patch the placeholder Lambda
ARNs in `skill-package/skill.json` locally first, then run:

```bash
ask deploy --target skill-metadata
```

---

## Step 6 — Test

1. In the Alexa app on your phone: enable the skill and link your Google account
2. Grant reminders permission when prompted
3. Say:

   ```text
   Alexa, ask nudge to sync my calendar
   ```

4. If you set up the Echo routine, use this recommended sequence:

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

5. Check the Alexa app → Reminders to confirm they were created or refreshed

---

## Environment Variables (Lambda)

| Variable | Description | Default |
|---|---|---|
| `GOOGLE_CLIENT_ID` | From Google Cloud Console | required |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console | required |
| `REMINDER_MINUTES_BEFORE` | Minutes before event to remind | `10` |

## Reminder-First Background Sync

The reminder-first path uses four deployed Lambdas:

- `AlexaAnnouncer` — the skill handler
- `NudgeTokenProxy` — receives Google OAuth token exchanges and stores refresh tokens
- `NudgeCalendarSync` — handles Google Calendar watch setup, webhook notifications, and incremental sync
- `NudgePoller` — optional backup notification worker; only needed if you keep the deprecated due-time notification path enabled

The DynamoDB table must use partition key `pk` and sort key `sk`. Enable TTL on the `expiresAt` attribute for stale due event cleanup.

Set these extra poller environment variables only if you keep the backup due
checker enabled:

| Variable | Description | Default |
|---|---|---|
| `LWA_CLIENT_ID` | Login with Amazon client ID for the optional backup notification path | required |
| `LWA_CLIENT_SECRET` | Login with Amazon client secret for the optional backup notification path | required |
| `DUE_GRACE_MINUTES` | How far back the due checker retries due buckets | `2` |
| `PROACTIVE_EVENTS_PATH` | Use `/v1/proactiveEvents/stages/development` before certification | `/v1/proactiveEvents/stages/development` |

Set these calendar sync environment variables to allow background update/delete
of existing spoken reminders:

| Variable | Description | Default |
|---|---|---|
| `LWA_CLIENT_ID` | Alexa Skill Messaging client ID from the Alexa Developer Console | required |
| `LWA_CLIENT_SECRET` | Alexa Skill Messaging client secret from the Alexa Developer Console | required |
| `GOOGLE_TOKEN_ENCRYPTION_KEY_BASE64` | Base64-encoded 32-byte key used to encrypt stored Google refresh tokens | required |
| `SYNC_NUDGE_INTERVAL_HOURS` | Not used while sync nudge notifications are disabled | `24` |

Set this extra skill Lambda environment variable if you want spoken reminders to
cover more than the default 7-day window when the user says "sync my calendar":

| Variable | Description | Default |
|---|---|---|
| `SYNC_LOOKAHEAD_HOURS` | How far ahead manual sync creates spoken Alexa Reminders | `168` |

Set these extra calendar sync environment variables:

| Variable | Description | Default |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Same Google OAuth client ID as the skill Lambda | required |
| `GOOGLE_CLIENT_SECRET` | Same Google OAuth client secret as the skill Lambda | required |
| `GOOGLE_TOKEN_ENCRYPTION_KEY_BASE64` | Same base64-encoded 32-byte encryption key used by the token proxy | required |
| `GOOGLE_WEBHOOK_URL` | Public API Gateway URL for Google watch notifications | required |
| `SYNC_LOOKAHEAD_HOURS` | How far ahead to create due event records | `48` |
| `WATCH_TTL_SECONDS` | Requested Google watch channel TTL | `604800` |
| `WATCH_RENEWAL_HOURS` | Renew watch channels this many hours before expiration | `24` |

Set `CALENDAR_SYNC_FUNCTION_NAME=NudgeCalendarSync` on the skill Lambda so
account linking and settings changes trigger watch setup.

For the reminder-first v1 path:

- keep `rate(1 minute) -> NudgePoller` disabled unless you want backup
  notifications
- keep `rate(1 hour) -> NudgeCalendarSync` enabled to renew watch channels and
  reconcile missed webhook changes
- use the Echo routine for quiet sync so brand-new events are picked up on the
  next run

Event-specific opt out: put `#silent` or `[silent]` in a Google Calendar event title or description. Nudge skips all-day, cancelled, and "free" events by default.
