module.exports = {
  // Minutes before an event to create the reminder
  REMINDER_MINUTES_BEFORE: parseInt(process.env.REMINDER_MINUTES_BEFORE || '10', 10),

  // How many hours ahead to scan for events when syncing spoken reminders.
  // Default: 7 days. Keep this configurable so we can tune reminder volume.
  SYNC_LOOKAHEAD_HOURS: parseInt(process.env.SYNC_LOOKAHEAD_HOURS || '168', 10),

  // Sync throttling and overlap protection.
  SYNC_COOLDOWN_SECONDS: parseInt(process.env.SYNC_COOLDOWN_SECONDS || '120', 10),
  QUIET_SYNC_COOLDOWN_SECONDS: parseInt(process.env.QUIET_SYNC_COOLDOWN_SECONDS || '300', 10),
  SYNC_IN_FLIGHT_SECONDS: parseInt(process.env.SYNC_IN_FLIGHT_SECONDS || '90', 10),

  // Google OAuth
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,

  // Alexa API endpoint (region-specific; us-east-1 for US skills)
  ALEXA_API_ENDPOINT: 'https://api.amazonalexa.com',

  // DynamoDB
  DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || 'NudgeUsers',
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
};
