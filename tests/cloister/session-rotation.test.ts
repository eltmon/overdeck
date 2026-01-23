/**
 * Tests for session-rotation.ts
 */

import { describe, it, expect } from 'vitest';
import {
  SESSION_ROTATION_THRESHOLD,
  DEFAULT_MEMORY_TIERS,
} from '../../src/lib/cloister/session-rotation.js';

describe('session-rotation', () => {
  describe('SESSION_ROTATION_THRESHOLD', () => {
    it('should be set to 100k tokens', () => {
      expect(SESSION_ROTATION_THRESHOLD).toBe(100_000);
    });
  });

  describe('DEFAULT_MEMORY_TIERS', () => {
    it('should have correct tier sizes', () => {
      expect(DEFAULT_MEMORY_TIERS.recent_summary).toBe(100);
      expect(DEFAULT_MEMORY_TIERS.recent_detailed).toBe(50);
      expect(DEFAULT_MEMORY_TIERS.recent_full).toBe(20);
    });

    it('should have tiered memory with summary >= detailed >= full', () => {
      expect(DEFAULT_MEMORY_TIERS.recent_summary).toBeGreaterThanOrEqual(
        DEFAULT_MEMORY_TIERS.recent_detailed
      );
      expect(DEFAULT_MEMORY_TIERS.recent_detailed).toBeGreaterThanOrEqual(
        DEFAULT_MEMORY_TIERS.recent_full
      );
    });
  });
});
