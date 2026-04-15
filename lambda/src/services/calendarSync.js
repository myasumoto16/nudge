const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const config = require('../config');

const lambda = new LambdaClient({ region: config.AWS_REGION });

async function requestCalendarSync(userId) {
  const functionName = process.env.CALENDAR_SYNC_FUNCTION_NAME;
  if (!functionName) return;

  await lambda.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({
      action: 'setupUser',
      userId,
    })),
  }));
}

module.exports = { requestCalendarSync };
