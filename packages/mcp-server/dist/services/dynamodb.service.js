import { DynamoDBClient, PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
let client = null;
/**
 * Get singleton DynamoDB client — initialized once at server startup.
 * Reused across requests for connection pooling.
 */
export function getDynamoDBClient() {
    if (!client) {
        client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
    }
    return client;
}
/**
 * Build idempotency key per F-04 §4.1.
 * Macro: <project_id>#<gate.toLowerCase().trim()>#<YYYY-MM-DD>
 * Micro: <project_id>#micro#<ULID>
 */
export function buildIdempotencyKey(projectId, type, gate, ulid) {
    if (type === 'macro' && gate) {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const normalizedGate = gate.toLowerCase().trim();
        return `${projectId}#${normalizedGate}#${today}`;
    }
    // Micro events: always unique (ULID guarantees)
    return `${projectId}#micro#${ulid}`;
}
/**
 * Attempt dedup sentinel write (conditional PutItem).
 * Returns { written: true } if sentinel created, { written: false } if duplicate detected.
 * Propagates unexpected DynamoDB errors.
 */
export async function attemptDedupSentinel(client, tableName, projectId, idempotencyKey) {
    try {
        await client.send(new PutItemCommand({
            TableName: tableName,
            Item: marshall({
                pk: `PROJECT#${projectId}`,
                sk: `DEDUP#${idempotencyKey}`,
                created_at: new Date().toISOString(),
                idempotency_key: idempotencyKey,
            }),
            ConditionExpression: 'attribute_not_exists(pk)',
        }));
        return { written: true };
    }
    catch (err) {
        if (err instanceof ConditionalCheckFailedException) {
            return { written: false };
        }
        throw err; // Propagate unexpected errors
    }
}
/**
 * Write governance event record to DynamoDB.
 * Throws on failure (caller catches and returns error response).
 */
export async function writeGovernanceEvent(client, tableName, record) {
    await client.send(new PutItemCommand({
        TableName: tableName,
        Item: marshall(record),
    }));
}
//# sourceMappingURL=dynamodb.service.js.map