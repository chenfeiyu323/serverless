const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2");
const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");

const region = process.env.AWS_REGION || "us-east-1";
const fromEmail = process.env.FROM_EMAIL; // e.g. no-reply@csye6225demo.com
const verificationBaseUrl = process.env.VERIFICATION_BASE_URL; // e.g. https://api.dev.csye6225demo.com/validateEmail
const dedupeTableName = process.env.DEDUPE_TABLE_NAME; // DynamoDB table name

const ses = new SESv2Client({ region });
const ddb = new DynamoDBClient({ region });

/**
 * SNS-triggered Lambda.
 * Expects SNS messages with JSON body:
 * {
 *   "email": "someone@example.com",
 *   "token": "<uuid>",
 *   "timestamp": "2025-11-13T01:23:45.000Z"
 * }
 */
const handler = async (event) => {
  console.log("Received event:", JSON.stringify(event));

  if (!fromEmail || !verificationBaseUrl || !dedupeTableName) {
    console.error("Missing required env variables");
    return;
  }

  const records = event.Records || [];
  const results = [];

  for (const record of records) {
    try {
      if (!record.Sns || !record.Sns.Message) {
        console.warn("Record without SNS message, skipping");
        continue;
      }

      const message = JSON.parse(record.Sns.Message);
      const email = message.email;
      const token = message.token;

      if (!email || !token) {
        console.warn("Message missing email or token, skipping:", message);
        continue;
      }

      const dedupeKey = `${email}#${token}`;

      // Write to DynamoDB with condition to avoid duplicates
      const putCmd = new PutItemCommand({
        TableName: dedupeTableName,
        Item: {
          message_key: { S: dedupeKey },
          created_at: { S: new Date().toISOString() }
        },
        ConditionExpression: "attribute_not_exists(message_key)"
      });

      try {
        await ddb.send(putCmd);
        console.log(`Recorded message_key=${dedupeKey} in DynamoDB`);
      } catch (err) {
        if (err.name === "ConditionalCheckFailedException") {
          console.log(`Duplicate message detected for ${dedupeKey}, skipping email`);
          continue;
        }
        throw err;
      }

      const verifyUrl = `${verificationBaseUrl}?email=${encodeURIComponent(
        email
      )}&token=${encodeURIComponent(token)}`;

      const emailBody = [
        "Hello,",
        "",
        "Please confirm your email address by clicking the link below:",
        verifyUrl,
        "",
        "If you did not create this account, you can ignore this email.",
        "",
        "Thank you."
      ].join("\n");

      const sendCmd = new SendEmailCommand({
        FromEmailAddress: fromEmail,
        Destination: {
          ToAddresses: [email]
        },
        Content: {
          Simple: {
            Subject: {
              Data: "Verify your email address"
            },
            Body: {
              Text: {
                Data: emailBody
              }
            }
          }
        }
      });

      const sendResp = await ses.send(sendCmd);
      console.log("SendEmail response:", sendResp);
      results.push({ email, status: "SENT" });
    } catch (err) {
      console.error("Failed to process record", err);
      results.push({ error: err.message || String(err), status: "ERROR" });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ results })
  };
};

module.exports = { handler };
