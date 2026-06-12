import { describe, it, expect } from '@jest/globals';
import { buildIdempotencyKey } from '../dynamodb.service';

describe('dynamodb.service', () => {
  describe('buildIdempotencyKey', () => {
    it('should build macro key: projectId#normalizedGate#YYYY-MM-DD', () => {
      const key = buildIdempotencyKey('rainn', 'macro', 'SRS approved', 'ulid-ignored');
      expect(key).toMatch(/^rainn#srs approved#\d{4}-\d{2}-\d{2}$/);
    });

    it('should normalize gate to lowercase and trim', () => {
      const key = buildIdempotencyKey('rainn', 'macro', '  SRS APPROVED  ', 'ulid');
      expect(key).toMatch(/^rainn#srs approved#\d{4}-\d{2}-\d{2}$/);
    });

    it('should build micro key: projectId#micro#ULID', () => {
      const ulid = '01J5K3M2N4P5Q6R7S8T9';
      const key = buildIdempotencyKey('rainn', 'micro', 'ignored-gate', ulid);
      expect(key).toBe(`rainn#micro#${ulid}`);
    });

    it('should ignore gate in micro key even if provided', () => {
      const key = buildIdempotencyKey('rainn', 'micro', 'SRS approved', 'ulid123');
      expect(key).toBe('rainn#micro#ulid123');
    });

    it('should return micro key when gate is undefined and type is micro', () => {
      const key = buildIdempotencyKey('rainn', 'micro', undefined, 'ulid-456');
      expect(key).toBe('rainn#micro#ulid-456');
    });

    it('should handle empty gate string for macro events', () => {
      // Empty gate should be treated as missing
      const key = buildIdempotencyKey('rainn', 'macro', '', 'ulid');
      // Falls through to micro pattern since gate is falsy
      expect(key).toMatch(/^rainn#micro#ulid$/);
    });
  });
});
