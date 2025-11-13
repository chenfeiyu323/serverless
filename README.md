# CSYE 6225 - Assignment 09 - Serverless (Email Lambda)

This repository contains the Lambda function that sends verification emails
when a new user account is created in the web application.

 The Lambda is triggered by an **SNS topic** in the DEV AWS account. The webapp
 publishes a message with `email` and `token`. The Lambda:
 1. Writes a record to a DynamoDB table for **de-duplication**.
 2. Sends a verification email via Amazon SES v2 with a link like:

    `https://{your-api-domain}/validateEmail?email=someone@example.com&token=<UUID>`

 ## Prerequisites

 - Node.js 18+ (recommended: Node 20)
 - npm
 - AWS account with:
   - SNS topic ARN (from Terraform output `sns_user_signup_topic_arn`)
   - DynamoDB table for dedupe (primary key `message_key` as string)
   - SES configured with a verified `FROM` email address
   - IAM Role for Lambda execution (with permission to use SES, DynamoDB, CloudWatch Logs)
 - Terraform changes in **tf-aws-infra-main** to create:
   - Lambda execution role and its policy
   - DynamoDB table
   - SNS subscription to this Lambda

 ## Local development

 ```bash
 # install dependencies
 npm install

 # run lint (placeholder)
 npm run lint
 ```

 The function entrypoint is `src/index.js` with exported `handler(event)`.

 ## Deployment via GitHub Actions

 The workflow `.github/workflows/deploy.yml` is triggered on every push to `main`.

 It will:

 1. Install Node.js
 2. Install dependencies
 3. Create a `lambda.zip` artifact
 4. Use AWS CLI to create or update the Lambda function

 ### Required GitHub Secrets

 In the **serverless** repository settings, configure:

 - `AWS_ACCESS_KEY_ID_DEV`
 - `AWS_SECRET_ACCESS_KEY_DEV`
 - `LAMBDA_EXEC_ROLE_ARN` – ARN of the Lambda execution role created by Terraform

 ### Recommended GitHub Variables

 Configure the following repository **variables**:

 - `DEDUPE_TABLE_NAME` – DynamoDB table name used for deduplication
 - `FROM_EMAIL` – Verified SES identity used as sender
 - `VERIFICATION_BASE_URL` – Base URL of your webapp validation endpoint, e.g.
   `https://api.dev.csye6225demo.com/validateEmail`

 ## Manual deployment (optional)

 If you want to deploy from local machine instead of GitHub Actions:

 ```bash
 npm install
 npm run build   # (or just npm install --omit=dev in a temp dir)

 zip -r lambda.zip src package.json package-lock.json

 aws lambda create-function       --function-name csye6225-a9-email-lambda       --runtime nodejs20.x       --role <LAMBDA_EXEC_ROLE_ARN>       --handler src/index.handler       --timeout 10       --memory-size 256       --environment "Variables={AWS_REGION=us-east-1,DEDUPE_TABLE_NAME=<table>,FROM_EMAIL=<from>,VERIFICATION_BASE_URL=<url>}"       --zip-file fileb://lambda.zip
 ```

 Subsequent updates can use `aws lambda update-function-code` and
 `aws lambda update-function-configuration`.

 ## Notes

 - The function uses DynamoDB `PutItem` with `ConditionExpression` to avoid
   sending duplicate emails when the same SNS message is delivered multiple times.
 - Make sure your SES account is **out of the sandbox**, otherwise you can only send
   to verified email addresses.
