import { z } from 'zod';
import { ulid } from 'ulid';
import { classifyEvent } from '@kiro-governance/shared/constants/macro-gates';
import { getDynamoDBClient, buildIdempotencyKey, attemptDedupSentinel, writeGovernanceEvent, } from '../services/dynamodb.service';
/**
 * Input schema for record_progress tool.
 * Per F-01 §3.2 — exact fields, validation, constraints.
 */
export const RecordProgressInputSchema = z.object({
    project_id: z.string().min(1),
    update_text: z.string().min(1).max(4096),
    type: z.enum(['macro', 'micro']).optional(),
    gate: z.string().optional(),
    phase: z.string().optional(),
    source_ref: z.string().min(1),
    actor: z.string().min(1),
    flag_override: z.boolean().optional(),
});
/**
 * Register record_progress MCP tool.
 * See mcp-server-core-architecture.md §3.2
 */
export function registerRecordProgress(server, config) {
    server.tool('record_progress', 'Write a governance event to DynamoDB with auto-classification and deduplication', RecordProgressInputSchema.shape, async (params) => {
        try {
            const input = RecordProgressInputSchema.parse(params);
            const result = await handleRecordProgress(input, config);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
        catch (err) {
            const error = err instanceof z.ZodError ? err.errors[0]?.message : String(err);
            return {
                content: [{ type: 'text', text: JSON.stringify({ error: 'VALIDATION_ERROR', message: error }) }],
            };
        }
    });
}
async function handleRecordProgress(input, config) {
    try {
        // Step 1: Classify event (F-01 §3.2, FR-03)
        const { resolvedType, matchedGate } = classifyEvent({
            update_text: input.update_text,
            type: input.type,
            flag_override: input.flag_override,
        });
        // Step 2: Derive gate (F-01 §3.2 FINDING-2)
        //   Priority: caller-provided > classification match > undefined
        let resolvedGate;
        if (input.gate) {
            resolvedGate = input.gate.toLowerCase().trim();
        }
        else if (resolvedType === 'macro' && matchedGate) {
            resolvedGate = matchedGate;
        }
        // Step 3: Generate ULID for sort key
        const eventUlid = ulid();
        // Step 4: Build idempotency key
        const idempotencyKey = buildIdempotencyKey(input.project_id, resolvedType, resolvedGate, eventUlid);
        // Step 5: Check dedup sentinel (macro only; micro always unique)
        const client = getDynamoDBClient();
        if (resolvedType === 'macro') {
            const dedupResult = await attemptDedupSentinel(client, config.tableName, input.project_id, idempotencyKey);
            if (!dedupResult.written) {
                console.info('[record_progress] Dedup hit', { projectId: input.project_id, idempotencyKey });
                return { written: false, reason: 'duplicate' };
            }
        }
        // Step 6: Build GovernanceEventRecord
        const now = new Date().toISOString();
        const pk = `PROJECT#${input.project_id}`;
        const sk = `UPDATE#${now}#${eventUlid}`;
        const record = {
            pk,
            sk,
            update_text: input.update_text,
            type: resolvedType,
            source_ref: input.source_ref,
            actor: input.actor,
            created_at: now,
            idempotency_key: idempotencyKey,
            ...(resolvedGate && { gate: resolvedGate }),
            ...(input.phase && { phase: input.phase }),
            ...(input.flag_override !== undefined && { flag_override: input.flag_override }),
        };
        // Step 7: Write event record (F-04 §4.2 Pattern 1)
        await writeGovernanceEvent(client, config.tableName, record);
        return { written: true, pk, sk };
    }
    catch (err) {
        console.error('[record_progress] DynamoDB write failed', { error: String(err) });
        return {
            written: false,
            reason: 'dynamodb_write_failed',
        };
    }
}
//# sourceMappingURL=record-progress.js.map