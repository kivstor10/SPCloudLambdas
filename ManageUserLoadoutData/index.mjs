import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetItemCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS,POST,PUT,DELETE,PATCH',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Content-Type': 'application/json',
};

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const TABLE_NAME = process.env.TABLE_NAME_UserLoadouts;

// Helper function to check if a user's loadout data exists
const userLoadoutExists = async (userId) => {
    const params = {
        TableName: TABLE_NAME,
        Key: marshall({ userId: userId, loadoutId: "default" }), // Include loadoutId.  Use "default" as a placeholder.  We only check if *any* loadout exists.
        ProjectionExpression: "userId", // Just check for the userId
        ConsistentRead: true,
    };

    const command = new GetItemCommand(params);
    try {
        const result = await ddbClient.send(command);
        console.log("GetItem Result:", result);
        return !!result.Item; // Returns true if result.Item is not null/undefined
    } catch (error) {
        console.error("Error checking loadout existence:", error);
        throw error; // Re-throw to be handled by caller
    }
};

/**
 * Retrieves the loadout name for a given userId and loadoutId.
 * GET /loadouts/{loadoutId}/name?userId=...
 */
const getLoadoutName = async (userId, loadoutId) => {
    const params = {
        TableName: TABLE_NAME,
        Key: marshall({ userId: userId, loadoutId: loadoutId }),
        ProjectionExpression: "loadoutName",
        ConsistentRead: true,
    };
    const command = new GetItemCommand(params);
    try {
        const result = await ddbClient.send(command);
        if (result.Item) {
            const unmarshalledItem = unmarshall(result.Item);
            return {
                statusCode: 200,
                headers: { CORS_HEADERS },
                body: JSON.stringify({ loadoutName: unmarshalledItem.loadoutName }),
            };
        } else {
            return {
                statusCode: 404,
                headers: { CORS_HEADERS },
                body: JSON.stringify({ error: `Loadout with ID "${loadoutId}" for user "${userId}" not found` }),
            };
        }
    } catch (error) {
        console.error("Error getting loadout name:", error);
        return {
            statusCode: 500,
            headers: { CORS_HEADERS },
            body: JSON.stringify({ error: "Internal server error" }),
        };
    }
};

/**
 * Creates a default user loadout.
 * POST /users/{userId}/loadouts/default
 */
const createDefaultUserLoadout = async (userId) => {
    const defaultLoadoutName = "DefaultLoadout";
    const defaultLoadoutId = "default";
    const defaultLoadout = {
        userId: userId,
        loadoutId: defaultLoadoutId,
        loadoutName: defaultLoadoutName,
        active: false,
        banks: {
            "A": Array(12).fill({ s3Key: "" }),
            "B": Array(12).fill({ s3Key: "" }),
            "C": Array(12).fill({ s3Key: "" }),
            "D": Array(12).fill({ s3Key: "" }),
            "E": Array(12).fill({ s3Key: "" }),
            "F": Array(12).fill({ s3Key: "" }),
            "G": Array(12).fill({ s3Key: "" }),
            "H": Array(12).fill({ s3Key: "" }),
            "I": Array(12).fill({ s3Key: "" }),
            "J": Array(12).fill({ s3Key: "" }),
        },
    };

    const params = {
        TableName: TABLE_NAME,
        Item: marshall(defaultLoadout, { convertEmptyValues: true }),
    };
    const command = new PutItemCommand(params);
    try {
        await ddbClient.send(command);
        console.log(`Default loadout "${defaultLoadoutName}" created for user: ${userId}`);
    } catch (error) {
        console.error("Error creating default loadout:", error);
        throw error;
    }
};

// Main Lambda handler function
export const handler = async (event) => {
    console.log("STARTING HANDLER");
    try {
        console.log("EVENT:", JSON.stringify(event, null, 2));
        const userId = event.queryStringParameters?.userId;
        const loadoutIdFromPath = event.pathParameters?.loadoutId; // Extract loadoutId from path

        let action = 'getLoadouts'; // Default action

        if (event.resource === '/loadouts' && event.httpMethod === 'POST') {
            action = 'createLoadout';
        } else if (event.resource === '/loadouts/{loadoutId}' && event.httpMethod === 'DELETE') {
            action = 'deleteLoadout';
        } else if (event.resource === '/loadouts/{loadoutId}/pads' && event.httpMethod === 'PUT') {
            action = 'updatePads';
        } else if (event.resource === '/loadouts/{loadoutId}' && event.httpMethod === 'PATCH') {
            action = 'renameLoadout';
        } else if (event.resource === '/loadouts/{loadoutId}/pads' && event.httpMethod === 'GET') {
            action = 'getLoadoutPads';
        } else if (event.resource === '/loadouts' && event.httpMethod === 'GET') {
            action = 'getLoadouts';
        } else if (event.resource === '/users/{userId}/loadouts/default' && event.httpMethod === 'POST') {
            action = 'createDefaultUserLoadout';
        } else if (event.resource === '/loadouts/{loadoutId}/active' && event.httpMethod === 'PATCH') {
            action = 'updateActiveStatus';
        }


        if (!userId && action !== 'createDefaultUserLoadout') {
            console.log("Missing userId");
            return {
                statusCode: 400,
                headers: { CORS_HEADERS },
                body: JSON.stringify({ error: "Missing userId parameter" }),
            };
        }

        try {
            console.log("SWITCH STATEMENT");
            switch (action) {
                case "getLoadouts":
                    return await getLoadouts(userId);
                case "createDefaultUserLoadout":
                    return await createDefaultUserLoadout(userId);
                case "createLoadout":
                    const loadoutId = event.queryStringParameters?.loadoutId;
                    const loadoutName = event.queryStringParameters?.loadoutName;
                    const activeParam = event.queryStringParameters?.active; // Changed variable name to avoid redeclaration
                    const body = JSON.parse(event.body || '{}');
                    return await createLoadout(userId, loadoutId, loadoutName, body, activeParam);
                case "deleteLoadout":
                    if (!loadoutIdFromPath) {
                        return { statusCode: 400, headers: { /* CORS Headers */ }, body: JSON.stringify({ error: "Missing loadoutId in path" }) };
                    }
                    return await deleteLoadout(userId, loadoutIdFromPath);
                case "updatePads":
                    if (!loadoutIdFromPath) {
                        return { statusCode: 400, headers: { /* CORS Headers */ }, body: JSON.stringify({ error: "Missing loadoutId in path" }) };
                    }
                    const bank = event.queryStringParameters?.bank;
                    const padNumber = parseInt(event.queryStringParameters?.padNumber, 10);
                    const s3Key = JSON.parse(event.body || '{}').s3Key;
                    return await updatePads(userId, loadoutIdFromPath, bank, padNumber, s3Key);
                case "renameLoadout":
                    if (!loadoutIdFromPath) {
                        return { statusCode: 400, headers: { /* CORS Headers */ }, body: JSON.stringify({ error: "Missing loadoutId in path" }) };
                    }
                    const newLoadoutName = JSON.parse(event.body || '{}').newLoadoutName;
                    return await renameLoadout(userId, loadoutIdFromPath, newLoadoutName);
                case "getLoadoutPads":
                    if (!loadoutIdFromPath) {
                        return { statusCode: 400, headers: { /* CORS Headers */ }, body: JSON.stringify({ error: "Missing loadoutId in path" }) };
                    }
                    return await getLoadoutPads(userId, loadoutIdFromPath);
                case "getLoadouts":
                    return await getLoadouts(userId);
                case "updateActiveStatus": // Add new case for updating active status
                    if (!loadoutIdFromPath) {
                        return { statusCode: 400, headers: { CORS_HEADERS }, body: JSON.stringify({ error: "Missing loadoutId in path" }) };
                    }
                    const active = JSON.parse(event.body || '{}').active;
                    return await updateActiveStatus(userId, loadoutIdFromPath, active);
                default:
                    console.log("Invalid action:", action);
                    return {
                        statusCode: 400,
                        headers: { CORS_HEADERS },
                        body: JSON.stringify({ error: "Invalid action" }),
                    };
            }
        } catch (error) {
            console.error("Error in handler:", error);
            return {
                statusCode: 500,
                headers: { CORS_HEADERS },
                body: JSON.stringify({ error: "Internal server error" }),
            };
        }
    } catch (error) {
        console.error("Error OUTSIDE main try:", error);
        return {
            statusCode: 500,
            headers: { CORS_HEADERS },
            body: JSON.stringify({ error: "Internal server error" }),
        };
    }
};

/**
 * Retrieves all loadouts for a given user, returning only loadoutId and loadoutName.
 * GET /loadouts?userId=...
 */
const getLoadouts = async (userId) => {
    console.log("getLoadouts called with userId:", userId);
    const params = {
        TableName: TABLE_NAME,
        KeyConditionExpression: "userId = :userId", // Query by userId
        ProjectionExpression: "loadoutId, loadoutName, active", // Include 'active' in projection
        ExpressionAttributeValues: marshall({
            ":userId": userId,
        }),
    };
    const command = new QueryCommand(params);
    try {
        const result = await ddbClient.send(command);
        console.log("DynamoDB Query Result:", JSON.stringify(result, null, 2));
        if (result.Items && result.Items.length > 0) {
            const loadouts = result.Items.map(item => ({
                loadoutId: unmarshall(item).loadoutId,
                loadoutName: unmarshall(item).loadoutName,
                active: unmarshall(item).active  // Include active status
            }));
            return {
                statusCode: 200,
                headers: CORS_HEADERS,
                body: JSON.stringify(loadouts),
            };
        } else {
            return {
                statusCode: 200, //  Return 200 with an empty array.  This is generally preferred.
                headers: CORS_HEADERS,
                body: JSON.stringify([]),
            };
        }

    } catch (error) {
        console.error("Error getting loadouts (query):", error);
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: "Error retrieving loadouts" }),
        };
    }
};


/**
 * Creates a new loadout for a user.
 * POST /loadouts?userId=...
 */
const createLoadout = async (userId, loadoutId, loadoutName, loadoutData, activeParam) => {
    if (!loadoutId) {
        return {
            statusCode: 400,
            headers: { CORS_HEADERS },
            body: JSON.stringify({ error: "loadoutId is required" }),
        };
    }
    if (!loadoutName) {
        return {
            statusCode: 400,
            headers: { CORS_HEADERS },
            body: JSON.stringify({ error: "loadoutName is required" }),
        };
    }
    if (!loadoutData || !loadoutData.banks) {
        return {
            statusCode: 400,
            headers: { CORS_HEADERS },
            body: JSON.stringify({ error: "loadoutData and loadoutData.banks are required" }),
        };
    }

    // Convert activeParam to a boolean.  It comes in as a string from the query string.
    const active = activeParam === 'true' || activeParam === true; // Handle both 'true' and true

    const item = {
        userId: userId,
        loadoutId: loadoutId,
        loadoutName: loadoutName,
        active: active,
        banks: loadoutData.banks,
    };
    const params = {
        TableName: TABLE_NAME,
        Item: marshall(item, { convertEmptyValues: true }),
        ConditionExpression: "NOT (userId = :userId AND loadoutId = :loadoutId)",
        ExpressionAttributeValues: marshall({
            ":userId": userId,
            ":loadoutId": loadoutId,
        }),
    };
    const command = new PutItemCommand(params);
    try {
        await ddbClient.send(command);
        return {
            statusCode: 201,
            headers: { CORS_HEADERS },
            body: JSON.stringify({ message: `Loadout "${loadoutName}" created successfully` }),
        };
    } catch (error) {
        if (error.name === "ConditionalCheckFailedException") {
            return {
                statusCode: 400,
                headers: { CORS_HEADERS },
                body: JSON.stringify({ error: `Loadout with id "${loadoutId}" already exists for this user.` }),
            };
        }
        console.error("Error creating loadout:", error);
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: "Internal server error" }),
        };
    }
};

/**
 * Deletes a loadout for a user.
 * DELETE /loadouts/{loadoutId}?userId=...
 */
const deleteLoadout = async (userId, loadoutId) => {
    console.log(`Deleting loadout with userId: ${userId}, loadoutId: ${loadoutId}`);
    const params = {
        TableName: TABLE_NAME,
        Key: marshall({ userId: userId, loadoutId: loadoutId }), // Use loadoutId
    };
    console.log("Delete Item Params:", params);

    const command = new DeleteItemCommand(params);
    try {
        const result = await ddbClient.send(command);
        console.log("Loadout deleted successfully:", result);
        return {
            statusCode: 200,
            headers: { CORS_HEADERS },
            body: JSON.stringify({ message: `Loadout with id "${loadoutId}" deleted successfully` }),
        };
    } catch (error) {
        console.error("Error deleting loadout:", error);
        throw error;
    }
};


/**
 * Updates the pad data (S3 key) for a specific pad in a loadout.
 * PUT /loadouts/{loadoutId}/pads?userId=...
 */
const updatePads = async (userId, loadoutId, bank, padNumber, s3Key) => {
    if (!loadoutId || !bank || !padNumber || !s3Key) {
        return {
            statusCode: 400,
            headers: { CORS_HEADERS },
            body: JSON.stringify({ error: "loadoutId, bank, padNumber, and s3Key are required" }),
        };
    }
    const params = {
        TableName: TABLE_NAME,
        Key: marshall({ userId: userId, loadoutId: loadoutId }), // Use loadoutId
        UpdateExpression: `SET banks.#bank[${padNumber - 1}].s3Key = :s3Key`,
        ExpressionAttributeNames: {
            "#bank": `banks.${bank}`,
        },
        ExpressionAttributeValues: marshall({
            ":s3Key": s3Key,
        }),
        ReturnValues: "ALL_NEW",
    };

    const command = new UpdateItemCommand(params);
    try {
        const result = await ddbClient.send(command);
        return {
            statusCode: 200,
            headers: { CORS_HEADERS },
            body: JSON.stringify(unmarshall(result.Attributes)),
        };
    } catch (error) {
        console.error("Error updating pad", error);
        throw error;
    }
};

/**
 * Renames a loadout.
 * PATCH /loadouts/{loadoutId}?userId=...
 */
const renameLoadout = async (userId, loadoutId, newLoadoutName) => {
    if (!loadoutId || !newLoadoutName) {
        return {
            statusCode: 400,
            headers: { CORS_HEADERS },
            body: JSON.stringify({ error: "loadoutId and newLoadoutName are required" }),
        };
    }

    const params = {
        TableName: TABLE_NAME,
        Key: marshall({ userId: userId, loadoutId: loadoutId }), // Use loadoutId
        UpdateExpression: "SET loadoutName = :newLoadoutName",
        ExpressionAttributeValues: marshall({
            ":newLoadoutName": newLoadoutName,
        }),
        ReturnValues: "ALL_NEW",

    };

    const command = new UpdateItemCommand(params);
    try {
        const result = await ddbClient.send(command);
        return {
            statusCode: 200,
            headers: { CORS_HEADERS },
            body: JSON.stringify(unmarshall(result.Attributes)),
        };

    } catch (error) {

        console.error("Error renaming loadout", error);
        throw error;
    }
};

/**
 * Retrieves all pad data for a given loadoutId and userId.
 * GET /loadouts/{loadoutId}/pads?userId=...
 */
const getLoadoutPads = async (userId, loadoutId) => {
    try {
        const params = {
            TableName: TABLE_NAME,
            Key: marshall({ userId: userId, loadoutId: loadoutId }), //  Query by userId and loadoutId.
        };
        const command = new GetItemCommand(params);
        const result = await ddbClient.send(command);

        if (result.Item) {
            const loadoutData = unmarshall(result.Item);
            // Remove userId and loadoutId from the response
            delete loadoutData.userId;
            delete loadoutData.loadoutId;
            return {
                statusCode: 200,
                headers: { CORS_HEADERS },
                body: JSON.stringify(loadoutData),
            };
        } else {
            return {
                statusCode: 404,
                headers: { CORS_HEADERS },
                body: JSON.stringify({ error: `Loadout with ID "${loadoutId}" for user "${userId}" not found` }), // Include userId in error
            };
        }
    } catch (error) {
        console.error(`Error retrieving pad data for loadout ${loadoutId} and user ${userId}:`, error);
        return {
            statusCode: 500,
            headers: { CORS_HEADERS },
            body: JSON.stringify({ error: `Failed to retrieve pad data: ${error.message}` }),
        };
    }
};

/**
 * Updates the active status of a loadout.
 * PATCH /loadouts/{loadoutId}/active?userId=...
 */
const updateActiveStatus = async (userId, loadoutId, active) => {
    if (!loadoutId || typeof active !== 'boolean') {
        return {
            statusCode: 400,
            headers: { CORS_HEADERS },
            body: JSON.stringify({ error: "loadoutId and active status (true/false) are required" }),
        };
    }

    const params = {
        TableName: TABLE_NAME,
        Key: marshall({ userId: userId, loadoutId: loadoutId }),
        UpdateExpression: "SET active = :active",
        ExpressionAttributeValues: marshall({
            ":active": active,
        }),
        ReturnValues: "ALL_NEW",
    };

    const command = new UpdateItemCommand(params);
    try {
        const result = await ddbClient.send(command);
        return {
            statusCode: 200,
            headers: { CORS_HEADERS },
            body: JSON.stringify(unmarshall(result.Attributes)),
        };
    } catch (error) {
        console.error("Error updating active status:", error);
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: "Internal server error" }),
        };
    }
};
