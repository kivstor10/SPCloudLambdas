import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { IoTDataPlaneClient, PublishCommand } from "@aws-sdk/client-iot-data-plane";
import https from 'https';
import { Buffer } from 'buffer';
import path from 'path';

// --- CORS Headers ---
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*', // Allows any origin
    'Access-Control-Allow-Methods': 'GET,OPTIONS,POST,PUT,DELETE,PATCH', // Allowed methods
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent', // Allowed headers
    'Content-Type': 'application/json', // Default content type for responses
};

// --- Hardcoded Configuration Values ---
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const AWS_REGION = process.env.AWS_REGION;
const AWS_IOT_ENDPOINT = process.env.AWS_IOT_ENDPOINT;
const PRESIGNED_URL_EXPIRY_SECONDS = parseInt(process.env.PRESIGNED_URL_EXPIRY_SECONDS, 10);

// --- Device API Configuration ---
const DEVICE_API_URL_BASE = process.env.DEVICE_API_URL_BASE;

// --- MQTT Payload Splitting Configuration ---
const ESP32_MAX_PACKET_SIZE = 2048;
const SAFETY_MARGIN_PERCENT = 10;
const MAX_JSON_PAYLOAD_SIZE = Math.floor(ESP32_MAX_PACKET_SIZE * (1 - SAFETY_MARGIN_PERCENT / 100.0));

// Initialize AWS SDK Clients
const s3Client = new S3Client({ region: AWS_REGION });
const iotDataPlaneClient = new IoTDataPlaneClient({
    region: AWS_REGION,
    endpoint: AWS_IOT_ENDPOINT
});

// Helper function to get deviceId from your external API
async function getDeviceIdFromApi(userId) {
    return new Promise((resolve, reject) => {
        const apiUrl = `${DEVICE_API_URL_BASE}?userId=${encodeURIComponent(userId)}`;
        console.log(`Querying Device API: ${apiUrl}`);

        https.get(apiUrl, (res) => {
            let rawData = '';
            res.on('data', (chunk) => { rawData += chunk; });
            res.on('end', () => {
                console.log(`Device API response status: ${res.statusCode}`);
                console.log(`Device API raw response: ${rawData}`);
                if (res.statusCode === 200) {
                    try {
                        const responseBody = JSON.parse(rawData);
                        let parsedData = responseBody;
                        if (typeof responseBody.body === 'string') {
                            try {
                                parsedData = JSON.parse(responseBody.body);
                            } catch (e) {
                                reject(new Error(`Failed to parse stringified body from Device API response: ${e.message}. Raw body: ${responseBody.body}`));
                                return;
                            }
                        }
                        const deviceId = parsedData.deviceId;
                        if (deviceId) {
                            resolve(deviceId);
                        } else {
                            reject(new Error(`'deviceId' not found in Device API response. Parsed data: ${JSON.stringify(parsedData)}`));
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse JSON from Device API response: ${e.message}. Raw data: ${rawData}`));
                    }
                } else {
                    reject(new Error(`Device API request failed with status ${res.statusCode}. Response: ${rawData}`));
                }
            });
        }).on('error', (e) => {
            reject(new Error(`Device API request error: ${e.message}`));
        });
    });
}

// Helper Function to Publish a Batch to MQTT
async function publishBatchToIot(topic, batchItems) {
    if (!batchItems || batchItems.length === 0) {
        console.log("publishBatchToIot: No items in batch to publish.");
        return;
    }
    const payloadJson = JSON.stringify(batchItems);
    const payloadSizeBytes = Buffer.from(payloadJson, 'utf-8').length;
    console.log(`Publishing batch to ${topic}. Size: ${payloadSizeBytes} bytes. Items: ${batchItems.length}`);
    try {
        const publishParams = {
            topic: topic,
            payload: payloadJson,
            qos: 1,
        };
        await iotDataPlaneClient.send(new PublishCommand(publishParams));
        console.log(`Successfully published batch of ${batchItems.length} items to ${topic}`);
    } catch (error) {
        console.error(`Error publishing batch to IoT topic ${topic}:`, error);
        throw error;
    }
}

export const handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));
    console.log(`Targeting MAX_JSON_PAYLOAD_SIZE: ${MAX_JSON_PAYLOAD_SIZE} bytes.`);

    if (!AWS_IOT_ENDPOINT || AWS_IOT_ENDPOINT.startsWith("YOUR_ACTUAL_IOT_ENDPOINT") || AWS_IOT_ENDPOINT.includes("your-iot-endpoint")) {
        const errorMessage = "FATAL: AWS_IOT_ENDPOINT is not configured correctly. Please replace placeholder.";
        console.error(errorMessage);
        return {
            statusCode: 500,
            headers: CORS_HEADERS, // Add CORS headers to error responses too
            body: JSON.stringify({ message: errorMessage })
        };
    }

    let userSub;
    let loadoutId;

    if (event.queryStringParameters) {
        userSub = event.queryStringParameters.userSub || event.queryStringParameters.userId;
        loadoutId = event.queryStringParameters.loadoutId;
    }

    if (!userSub) {
        return {
            statusCode: 400,
            headers: CORS_HEADERS,
            body: JSON.stringify({ message: "Query parameter 'userSub' (or 'userId') is required." })
        };
    }
    if (!loadoutId) {
        return {
            statusCode: 400,
            headers: CORS_HEADERS,
            body: JSON.stringify({ message: "Query parameter 'loadoutId' is required." })
        };
    }

    let deviceId;
    try {
        deviceId = await getDeviceIdFromApi(userSub);
        console.log(`Retrieved deviceId: ${deviceId}`);
    } catch (error) {
        console.error("Failed to retrieve deviceId from API:", error.message);
        return {
            statusCode: 502, // Bad Gateway, as we failed to talk to an upstream service
            headers: CORS_HEADERS,
            body: JSON.stringify({ message: "Failed to retrieve device information.", error: error.message })
        };
    }

    const dynamicMqttTopic = `/presignedurls/${deviceId}`;
    const s3PathPrefix = `public/public/${userSub}/${loadoutId}/`;
    console.log(`Constructed S3 path prefix: ${s3PathPrefix}`);

    try {
        const listObjectsParams = { Bucket: S3_BUCKET_NAME, Prefix: s3PathPrefix };
        const listedObjectsOutput = await s3Client.send(new ListObjectsV2Command(listObjectsParams));

        if (!listedObjectsOutput.Contents || listedObjectsOutput.Contents.length === 0) {
            console.log("No objects found at the specified S3 path.");
            return {
                statusCode: 200, // Or 404 if you prefer for "no objects found"
                headers: CORS_HEADERS,
                body: JSON.stringify({ message: "No objects found to process for the given userSub and loadoutId." })
            };
        }

        const allUrlInfos = [];
        for (const object of listedObjectsOutput.Contents) {
            if (object.Key.endsWith('/') && object.Size === 0) continue;
            const getObjectParams = { Bucket: S3_BUCKET_NAME, Key: object.Key };
            const url = await getSignedUrl(s3Client, new GetObjectCommand(getObjectParams), {
                expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
            });
            allUrlInfos.push({ key: object.Key, presignedUrl: url });
        }

        if (allUrlInfos.length === 0) {
            console.log("No files found to generate presigned URLs for (only folders might have been present).");
            return {
                statusCode: 200,
                headers: CORS_HEADERS,
                body: JSON.stringify({ message: "No files found for presigned URLs." })
            };
        }

        let currentBatch = [];
        let totalPublishedCount = 0;
        for (const urlInfo of allUrlInfos) {
            const potentialNextBatch = currentBatch.concat([urlInfo]);
            const potentialPayloadStr = JSON.stringify(potentialNextBatch);
            const potentialPayloadSizeBytes = Buffer.from(potentialPayloadStr, 'utf-8').length;

            if (potentialPayloadSizeBytes <= MAX_JSON_PAYLOAD_SIZE) {
                currentBatch = potentialNextBatch;
            } else {
                if (currentBatch.length > 0) {
                    await publishBatchToIot(dynamicMqttTopic, currentBatch);
                    totalPublishedCount += currentBatch.length;
                }
                const singleItemBatchStr = JSON.stringify([urlInfo]);
                const singleItemSizeBytes = Buffer.from(singleItemBatchStr, 'utf-8').length;
                if (singleItemSizeBytes > MAX_JSON_PAYLOAD_SIZE) {
                    console.error(`Single item for key '${urlInfo.key}' (JSON size: ${singleItemSizeBytes} bytes) exceeds MAX_JSON_PAYLOAD_SIZE. Skipping.`);
                    currentBatch = [];
                } else {
                    currentBatch = [urlInfo];
                }
            }
        }
        if (currentBatch.length > 0) {
            await publishBatchToIot(dynamicMqttTopic, currentBatch);
            totalPublishedCount += currentBatch.length;
        }
        
        console.log(`Successfully processed and published ${totalPublishedCount} presigned URLs in batches.`);
        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: JSON.stringify({
                message: "Successfully generated and published presigned URLs.",
                totalItemsProcessed: allUrlInfos.length,
                totalItemsPublished: totalPublishedCount,
                topic: dynamicMqttTopic,
                s3PrefixQueried: s3PathPrefix
            }),
        };

    } catch (error) {
        console.error("Error during S3 operations or MQTT publish:", error);
        let statusCode = 500;
        let errorMessage = "Failed to process request.";

        if (error.name === 'NoSuchKey') {
            statusCode = 404;
            errorMessage = `S3 path not found or empty for prefix: ${s3PathPrefix}`;
        }
        
        return {
            statusCode: statusCode,
            headers: CORS_HEADERS,
            body: JSON.stringify({ message: errorMessage, error: error.message })
        };
    }
};