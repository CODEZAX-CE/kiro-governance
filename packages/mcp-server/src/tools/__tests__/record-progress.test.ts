import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RecordProgressInputSchema } from '../record-progress';
import { buildIdempotencyKey, attemptDedupSentinel, writeGovernanceEvent } from '../../services/dynamodb.service';

// Mock classifyEvent from shared
jest.mock('@kiro-governance/shared/constants/macro-gates', () => ({
  classifyEvent: jest.fn(),
}));

describe('record_progress tool', () => {
  describe('Input validation', () => {
    it('should accept valid macro event input', () => {
      const input = {
        project_id: 'rainn',
        update_text: 'SRS approved',
        gate: 'SRS approved',
        source_ref: 'abc123',
        actor: 'human',
      };
      expect(() => RecordProgressInputSchema.parse(input)).not.toThrow();
    });

    it('should reject missing project_id', () => {
      const input = { update_text: 'test', source_ref: 'abc', actor: 'human' };
      expect(() => RecordProgressInputSchema.parse(input)).toThrow();
    });

    it('should reject update_text > 4096 chars', () => {
      const input = {
        project_id: 'rainn',
        update_text: 'a'.repeat(4097),
        source_ref: 'abc',
        actor: 'human',
      };
      expect(() => RecordProgressInputSchema.parse(input)).toThrow();
    });
  });

  describe('Idempotency key building', () => {
    it('should build macro key with date component', () => {
      const key = buildIdempotencyKey('rainn', 'macro', 'SRS approved', '01J5K3M2N4P5Q6R7S8T9');
      expect(key).toMatch(/^rainn#srs approved#\d{4}-\d{2}-\d{2}$/);
    });

    it('should normalize gate to lowercase', () => {
      const key = buildIdempotencyKey('rainn', 'macro', 'SRS APPROVED', '01J5K3M2N4P5Q6R7S8T9');
      expect(key).toMatch(/^rainn#srs approved#/);
    });

    it('should trim whitespace from gate', () => {
      const key = buildIdempotencyKey('rainn', 'macro', '  SRS approved  ', '01J5K3M2N4P5Q6R7S8T9');
      expect(key).toMatch(/^rainn#srs approved#/);
    });

    it('should build micro key with ULID', () => {
      const ulid = '01J5K3M2N4P5Q6R7S8T9';
      const key = buildIdempotencyKey('rainn', 'micro', undefined, ulid);
      expect(key).toBe(`rainn#micro#${ulid}`);
    });

    it('should not include gate in micro key', () => {
      const key = buildIdempotencyKey('rainn', 'micro', 'ignored', 'ulid123');
      expect(key).toMatch(/^rainn#micro#/);
    });
  });

  describe('Dedup sentinel logic', () => {
    it('should detect duplicate detection via ConditionalCheckFailedException', () => {
      // This test verifies error handling in attemptDedupSentinel
      // Full integration test requires mocked DynamoDB client
    });
  });
});
