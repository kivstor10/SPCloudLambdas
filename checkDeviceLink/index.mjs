import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

// Set the AWS Region.
const AWS_REGION = process.env.AWS_REGION; // Replace with your AWS region
const ddbClient = new DynamoDBClient({ region: AWS_REGION });
const TABLE_NAME = process.env.TABLE_NAME_SPCloudUserDeviceLinks; // Make sure this matches your table name
const DEVICE_ID_INDEX_NAME = "deviceId-index"; //  The name of the GSI on deviceId

/**
 * Lambda function to check if a deviceId has an associated userId in the SPCloudUserDeviceLinks table.
 *
 * @param {object} event - The Lambda event object.  Expected to contain deviceId in the query string.
 * @returns {Promise<object>} - A promise that resolves with a JSON object.
 * { isLinked: true/false, userId?: string }
 */
export const handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  // 1. Extract deviceId from the query string.
  const deviceId = event.queryStringParameters?.deviceId;

  // 2. Validate the deviceId.
  if (!deviceId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "deviceId is required in the query string." }),
    };
  }

  console.log("Checking deviceId:", deviceId);

  try {
    // 3. Construct the DynamoDB query.  Use the Global Secondary Index (GSI).
    const params = {
      TableName: TABLE_NAME,
      IndexName: DEVICE_ID_INDEX_NAME, //  Use the GSI
      KeyConditionExpression: "deviceId = :deviceId",
      ExpressionAttributeValues: {
        ":deviceId": { S: deviceId },
      },
      ProjectionExpression: "userId", //  only need the userId
      Limit: 1, // We only need to check for one link.
    };

    console.log("DynamoDB query params:", JSON.stringify(params, null, 2));

    // 4. Query the DynamoDB table.
    const command = new QueryCommand(params);
    const result = await ddbClient.send(command);

    console.log("DynamoDB query response:", JSON.stringify(result, null, 2));

    // 5. Process the result.
    if (result.Items && result.Items.length > 0) {
      // DeviceId found, meaning it is linked.
      const unmarshalledItem = unmarshall(result.Items[0]); // Unmarshall the item.
      const userId = unmarshalledItem.userId;
      console.log("Device is linked. userId:", userId);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isLinked: true, userId: userId }),
      };
    } else {
      // DeviceId not found, meaning it is not linked.
      console.log("Device is not linked.");
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isLinked: false }),
      };
    }
  } catch (error) {
    // 6. Handle errors.
    console.error("Error querying DynamoDB:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error: " + error.message }),
    };
  }
};
