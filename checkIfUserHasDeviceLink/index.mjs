import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

// Set the AWS Region.
const AWS_REGION = process.env.AWS_REGION;
const ddbClient = new DynamoDBClient({ region: AWS_REGION });
const TABLE_NAME = process.env.TABLE_NAME_SPCloudUserDeviceLinks;

/**
 * Lambda function to check if a userId has a linked device in the SPCloudUserDeviceLinks table.
 *
 * @param {object} event - The Lambda event object.  Expected to contain userId in the query string.
 * @returns {Promise<object>} - A promise that resolves with a JSON object.
 * { isLinked: true, deviceId?: string }
 */
export const handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    // 1. Extract userId from the query string.
    const userId = event.queryStringParameters?.userId;

    // 2. Validate the userId.
    if (!userId) {
        return {
            statusCode: 400,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*", // Added CORS header
                "Access-Control-Allow-Methods": "GET,OPTIONS", // Added CORS header
                "Access-Control-Allow-Headers": "Content-Type", // Added CORS header
            },
            body: JSON.stringify({ error: "userId is required in the query string." }),
        };
    }

    console.log("Checking userId:", userId);

    try {
        // 3. Construct the DynamoDB query.  Use userId as the key.
        const params = {
            TableName: TABLE_NAME,
            KeyConditionExpression: "userId = :userId",
            ExpressionAttributeValues: {
                ":userId": { S: userId },
            },
            ProjectionExpression: "deviceId", //  Only project the deviceId
            Limit: 1, // We only need to check for one linked device.
        };

        console.log("DynamoDB query params:", JSON.stringify(params, null, 2));

        // 4. Query the DynamoDB table.
        const command = new QueryCommand(params);
        const result = await ddbClient.send(command);
        console.log("DynamoDB query response:", JSON.stringify(result, null, 2));

        // 5. Process the result.
        if (result.Items && result.Items.length > 0) {
            // userId found, meaning it has a linked device.
            const unmarshalledItem = unmarshall(result.Items[0]);
            const deviceId = unmarshalledItem.deviceId;
            console.log("User has a linked device. deviceId:", deviceId);
            return {
                statusCode: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*", // Added CORS header
                    "Access-Control-Allow-Methods": "GET,OPTIONS", // Added CORS header
                    "Access-Control-Allow-Headers": "Content-Type", // Added CORS header
                },
                body: JSON.stringify({ isLinked: true, deviceId: deviceId }), // Include deviceId in the response
            };
        } else {
            // userId not found, meaning it does not have a linked device.
            console.log("User does not have a linked device.");
            return {
                statusCode: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*", // Added CORS header
                    "Access-Control-Allow-Methods": "GET,OPTIONS", // Added CORS header
                    "Access-Control-Allow-Headers": "Content-Type", // Added CORS header
                },
                body: JSON.stringify({ isLinked: false }),
            };
        }
    } catch (error) {
        // 6. Handle errors.
        console.error("Error querying DynamoDB:", error);
        return {
            statusCode: 500,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*", // Added CORS header
                "Access-Control-Allow-Methods": "GET,OPTIONS", // Added CORS header
                "Access-Control-Allow-Headers": "Content-Type", // Added CORS header
            },
            body: JSON.stringify({ error: "Internal server error: " + error.message }),
        };
    }
};
