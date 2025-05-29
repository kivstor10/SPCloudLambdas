import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane'; // Import for IoT Data Plane

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocument.from(client);
const iotDataClient = new IoTDataPlaneClient({ region: process.env.AWS_REGION }); // Initialize IoT Data Plane client with region from env
const spCloudDeviceRegTable = process.env.SPCLOUD_DEVICE_REG_TABLE;
const registrationCodeIndex = process.env.REGISTRATION_CODE_INDEX;
const userDeviceLinkTable = process.env.USER_DEVICE_LINK_TABLE;
const MQTT_TOPIC = process.env.MQTT_TOPIC; // Define the MQTT topic

export const handler = async (event) => {
  const registrationCode = event.queryStringParameters?.regCode || event.regCode;
  const userId = event.queryStringParameters?.userId;
  console.log('Received registrationCode from frontend:', registrationCode);
  console.log('Received userId from frontend:', userId);

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
    "Content-Type": "application/json",
  };

  if (!registrationCode) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Registration code is required.' }),
    };
  }

  if (!userId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'User ID is required.' }),
    };
  }

  const searchValue = JSON.stringify({ registrationCode: registrationCode.toUpperCase() });
  console.log('searchValue being used in query:', searchValue);

  const params = {
    TableName: spCloudDeviceRegTable,
    IndexName: registrationCodeIndex,
    KeyConditionExpression: 'registrationCode = :regCode',
    ExpressionAttributeValues: {
      ':regCode': JSON.stringify({ registrationCode: registrationCode.toUpperCase() }),
    },
    ProjectionExpression: 'deviceId',
  };

  try {
    const data = await dynamodb.query(params);
    console.log('DynamoDB query response (SPCloudDeviceReg):', JSON.stringify(data));

    const deviceId = data.Items && data.Items.length > 0 ? data.Items[0].deviceId : null;

    if (deviceId) {
      // Create the link in the UserDeviceLink table
      const linkParams = {
        TableName: userDeviceLinkTable,
        Item: {
          userId: userId,
          deviceId: deviceId,
          linkedAt: new Date().toISOString(),
        },
      };
      await dynamodb.put(linkParams);
      console.log('Successfully linked device', deviceId, 'to user', userId);

      // Publish MQTT message to notify the device
      try {
        const mqttParams = {
          topic: MQTT_TOPIC,
          payload: JSON.stringify({ status: 'linked', deviceId: deviceId }),
          qos: 0, // Or 1
        };
        const publishCommand = new PublishCommand(mqttParams);
        const publishResult = await iotDataClient.send(publishCommand);
        console.log('MQTT publish response:', publishResult);
      } catch (err) {
        console.error('Error publishing MQTT message:', err);
        // Consider adding error handling or retry logic for MQTT publishing
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ deviceId }),
      };
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid registration code.' }),
      };
    }
  } catch (error) {
    console.error('Error querying DynamoDB:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Could not verify and link device.' }),
    };
  }
};