# CSYE 6225 Email Lambda

Serverless companion service for the Assignment 09 web application. The Lambda
is triggered by the `csye6225-a4-user-signup` SNS topic, records every message in
DynamoDB for de-duplication, then sends a verification email through Amazon SES
with a link to the API's `/v1/verifyEmail` endpoint.

## Architecture
- Webapp publishes `{ email, token, requestedAt }` events to SNS.
- SNS fan-outs to `csye6225-a9-email-lambda` (deployed from this repo).
- Lambda writes `message_key = email#token` to DynamoDB (table:
  `csye6225-a4-email-dedupe`) to prevent duplicate sends.
- Lambda calls SES v2 to deliver an email that links to
  `https://<alb>/v1/validateEmail?email=...&token=...`.

Terraform (`../terra`) already provisions the SNS topic, IAM role policy,
DynamoDB table and Lambda permission/subscription; this repo's job is simply to
package and update the Lambda code.

## Prerequisites
1. **Node.js 20+** – used for local installs and packaging.
2. **AWS CLI v2** – required for manual deploy/test commands.
3. **IAM role** (`csye6225-a4-a9-lambda-role`) with access to
   `ses:SendEmail`, `ses:SendRawEmail`, `dynamodb:PutItem`, and CloudWatch Logs.
4. **Amazon SES configuration**:
   - The `FROM_EMAIL` identity must be verified in `us-east-1`.
   - If the account is still in the SES sandbox, every recipient (or the entire
     domain) must also be verified or emails will be suppressed.
5. **Terraform outputs** from the infra repo (`terraform -chdir=terra output`):
   - `sns_user_signup_topic_arn`
   - `dynamodb_dedupe_table_name`
   - `alb_dns_name` (to build `VERIFICATION_BASE_URL`).

## Local setup
```bash
cd serverless
npm install
```
This installs dependencies and produces `package-lock.json` for reproducible
builds.

## Deployment options
### 1. GitHub Actions (recommended)
The workflow in `.github/workflows/deploy.yml` zips the Lambda, installs
production dependencies, and either creates or updates the function. Configure
these secrets/variables in the repository settings:

| Name | Type | Description |
| --- | --- | --- |
| `AWS_ACCESS_KEY_ID_DEV`, `AWS_SECRET_ACCESS_KEY_DEV` | Secret | IAM user with permission to update the Lambda. |
| `LAMBDA_EXEC_ROLE_ARN` | Secret | ARN of `csye6225-a4-a9-lambda-role`. |
| `FROM_EMAIL` | Variable | Verified SES identity, e.g. `no-reply@dev.csye6225demo.com`. |
| `VERIFICATION_BASE_URL` | Variable | Full HTTPS URL to `/validateEmail`, for example `https://csye6225-a4-alb-xxxx.us-east-1.elb.amazonaws.com/v1/validateEmail`. |
| `DEDUPE_TABLE_NAME` | Variable | DynamoDB table name from Terraform output. |

Push to `main` to trigger the pipeline.

### 2. Manual CLI deploy
Useful for urgent fixes when CI is unavailable.
```bash
npm install --omit=dev
zip -r lambda.zip src package.json package-lock.json node_modules
aws lambda update-function-code --function-name csye6225-a9-email-lambda --zip-file fileb://lambda.zip
aws lambda update-function-configuration \
  --function-name csye6225-a9-email-lambda \
  --environment "Variables={DEDUPE_TABLE_NAME=csye6225-a4-email-dedupe,FROM_EMAIL=no-reply@dev.csye6225demo.com,VERIFICATION_BASE_URL=https://.../v1/validateEmail}"
```

## Testing & troubleshooting
1. **Publish a synthetic SNS event** after redeploying the Lambda:
   ```powershell
   $topic = terraform -chdir=terra output -raw sns_user_signup_topic_arn
   aws sns publish --topic-arn $topic --message '{"email":"demo@example.com","token":"12345","requestedAt":"2025-11-15T15:00:00Z"}'
   ```
2. **Tail Lambda logs** to confirm execution:
   ```powershell
   aws logs tail /aws/lambda/csye6225-a9-email-lambda --since 5m --follow
   ```
   (Requires IAM permission `logs:FilterLogEvents`).
3. **SES sandbox**: if messages never arrive, verify the recipient address or
   request production access in SES.
4. **DynamoDB duplicates**: the lambda skips emails if the same
   `email#token` already exists. Delete older entries from the table when
   re-running manual tests.

## How this fixes the webapp issue
- Webapp instances now receive `SNS_USER_SIGNUP_TOPIC_ARN` via
  `terra/webapp_user_data.tf`, so each signup publishes to the topic.
- This repo packages a CommonJS Lambda handler that Node.js 20 can execute,
  preventing the previous syntax error and allowing SES to deliver the
  verification email.

## Pushing changes
After updating the serverless repo:
```bash
git status
git add README.md package-lock.json src/index.js
git commit -m "docs: document lambda deployment and fix handler exports"
git push origin main
```
Pushing to `main` automatically redeploys the Lambda via GitHub Actions.
