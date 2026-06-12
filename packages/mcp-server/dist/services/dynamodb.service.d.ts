import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GovernanceEventRecord } from '@kiro-governance/shared/types/governance-event';
/**
 * Get singleton DynamoDB client — initialized once at server startup.
 * Reused across requests for connection pooling.
 */
export declare function getDynamoDBClient(): DynamoDBClient;
/**
 * Build idempotency key per F-04 §4.1.
 * Macro: <project_id>#<gate.toLowerCase().trim()>#<YYYY-MM-DD>
 * Micro: <project_id>#micro#<ULID>
 */
export declare function buildIdempotencyKey(projectId: string, type: 'macro' | 'micro', gate: string | undefined, ulid: string): string;
/**
 * Attempt dedup sentinel write (conditional PutItem).
 * Returns { written: true } if sentinel created, { written: false } if duplicate detected.
 * Propagates unexpected DynamoDB errors.
 */
export declare function attemptDedupSentinel(client: DynamoDBClient, tableName: string, projectId: string, idempotencyKey: string): Promise<{
    written: boolean;
}>;
/**
 * Write governance event record to DynamoDB.
 * Throws on failure (caller catches and returns error response).
 */
export declare function writeGovernanceEvent(client: DynamoDBClient, tableName: string, record: GovernanceEventRecord): Promise<void>;
//# sourceMappingURL=dynamodb.service.d.ts.map