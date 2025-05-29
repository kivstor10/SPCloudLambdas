import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";

// Define the table name as a constant
const tableName = process.env.TABLE_NAME_SPCloudUserDeviceLinks;

// Create a DynamoDB client
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export const handler = async (event, context) => {
  try {
    // Extract userId from the event
    if (!event.queryStringParameters || !event.queryStringParameters.userId) {
      return {
        statusCode: 400,
        headers: {  // Added CORS headers
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "DELETE,OPTIONS", // Important: Include OPTIONS
          "Access-Control-Allow-Headers": "Content-Type",
        },
        body: JSON.stringify({ message: "Missing userId in event" }),
      };
    }
    const userId = event.queryStringParameters.userId;

    // Log the table name
    console.log("Table Name:", tableName);

    // Create the DeleteCommand
    const command = new DeleteCommand({
      TableName: tableName, // Corrected property name
      Key: { userId: userId },
    });

    // Send the command
    const response = await docClient.send(command);

    // Check the response for success
    if (response.$metadata.httpStatusCode === 200) {
      return {
        statusCode: 200,
        headers: {  // Added CORS headers
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "DELETE,OPTIONS", // Important: Include OPTIONS
          "Access-Control-Allow-Headers": "Content-Type",
        },
        body: JSON.stringify({ message: "Device link deleted successfully" }),
      };
    } else {
      return {
        statusCode: 500,
        headers: {  // Added CORS headers
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "DELETE,OPTIONS", // Important: Include OPTIONS
          "Access-Control-Allow-Headers": "Content-Type",
        },
        body: JSON.stringify({
          message: "Failed to delete device link",
          response: response,
        }),
      };
    }
  } catch (error) {
    const errorMessage = `Error deleting device link: ${error.message}`;
    console.error(errorMessage);
    return {
      statusCode: 500,
      headers: {  // Added CORS headers
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "DELETE,OPTIONS", // Important: Include OPTIONS
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify({ message: errorMessage }),
    };
  }
};
