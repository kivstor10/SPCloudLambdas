# SPCloudLambdas

## Project Structure

This repository contains several AWS Lambda functions, each in its own directory:

```
SPCloudLambdas/
├── checkDeviceLink/
│   └── index.mjs
├── checkIfUserHasDeviceLink/
│   └── index.mjs
├── DisconnectDevice/
│   └── index.mjs
├── generatePresignedUrls/
│   └── index.mjs
├── ManageUserLoadoutData/
│   └── index.mjs
├── verifyRegCode/
│   └── index.mjs
└── .env
```

Each folder contains the code for a single Lambda function. All sensitive configuration (such as AWS region, table names, endpoints, etc.) is stored in the `.env` file at the root of the project.

## .env Configuration

Before deploying or running any Lambda, create a `.env` file in the root directory with the following variables:

```
AWS_REGION=your-aws-region
TABLE_NAME_SPCloudUserDeviceLinks=your-table-name
TABLE_NAME_UserLoadouts=your-user-loadouts-table
S3_BUCKET_NAME=your-s3-bucket
AWS_IOT_ENDPOINT=your-iot-endpoint-url
DEVICE_API_URL_BASE=your-device-api-url
PRESIGNED_URL_EXPIRY_SECONDS=3600
MQTT_TOPIC=your-mqtt-topic
SPCLOUD_DEVICE_REG_TABLE=your-device-reg-table
REGISTRATION_CODE_INDEX=your-registration-code-index
USER_DEVICE_LINK_TABLE=your-user-device-link-table
```

**Note:** The `.env` file is excluded from version control via `.gitignore` and should be created manually for each environment.

## Deploying Lambda Functions

To add a Lambda function to the AWS Lambda Console:

1. Navigate to the folder of the Lambda you want to deploy (e.g., `checkDeviceLink/`).
2. Zip the contents of the folder (not the folder itself). For example, in PowerShell:
   ```powershell
   cd checkDeviceLink
   Compress-Archive -Path * -DestinationPath ../checkDeviceLink.zip
   ```
3. Go to the AWS Lambda Console and create a new Lambda function (or select an existing one).
4. Under the "Code" section, choose "Upload from" > ".zip file" and upload your zipped file (e.g., `checkDeviceLink.zip`).
5. Set the handler to `index.handler` (or as appropriate for your entry point).
6. Make sure to set the required environment variables in the Lambda Console using the values from your `.env` file.

**Repeat** for each Lambda function you want to deploy.

## Notes
- Do not commit your `.env` file to version control.
- Update the `.env` file as needed for each environment (development, staging, production).
- Ensure all dependencies are included in the zip if your Lambda uses external packages.
