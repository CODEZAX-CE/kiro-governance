/**
 * Canonical DynamoDB record shape for kiro-governance-tracker table.
 * Single source of truth — unified-data-model.md §2.6
 */
export interface GovernanceEventRecord {
  /** Partition key: PROJECT#<project_id> */
  pk: string;

  /** Sort key: UPDATE#<ISO-timestamp>#<ULID> or DEDUP#<idempotency_key> */
  sk: string;

  /** Human-readable event description (max 4096 chars) */
  update_text: string;

  /** Event classification */
  type: 'macro' | 'micro';

  /** True if type was manually overridden; undefined if auto-classified */
  flag_override?: boolean;

  /** Canonical macro gate name. Present for macro events, absent for micro. */
  gate?: string;

  /** Phase grouping (e.g., "Phase 1") */
  phase?: string;

  /** Provenance — commit SHA or file line reference */
  source_ref: string;

  /** Who emitted/approved (agent name or human name) */
  actor: string;

  /** ISO-8601 creation timestamp */
  created_at: string;

  /** Deduplication key */
  idempotency_key: string;
}

/**
 * Dedup sentinel record (same table, special SK prefix).
 * Not a governance event — control record only.
 */
export interface DeduplicatedSentinelRecord {
  pk: string; // PROJECT#<project_id>
  sk: string; // DEDUP#<idempotency_key>
  created_at: string;
  idempotency_key: string;
}
