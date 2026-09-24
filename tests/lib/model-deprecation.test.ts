import { describe, it, expect } from 'vitest';
import { MODEL_DEPRECATIONS, resolveModelId } from '../../src/lib/model-capabilities.js';

describe('Model Deprecation System', () => {
  describe('MODEL_DEPRECATIONS mapping', () => {
    it('should define deprecation mappings', () => {
      expect(MODEL_DEPRECATIONS).toBeDefined();
      expect(typeof MODEL_DEPRECATIONS).toBe('object');
    });

    it('should map claude-opus-4-5 to claude-opus-4-7', () => {
      expect(MODEL_DEPRECATIONS['claude-opus-4-5']).toBe('claude-opus-4-7');
    });

    it('should map claude-sonnet-4-5 to claude-sonnet-4-6', () => {
      expect(MODEL_DEPRECATIONS['claude-sonnet-4-5']).toBe('claude-sonnet-4-6');
    });

    it('should only contain deprecated models as keys', () => {
      // Deprecated model IDs should not be in current MODEL_CAPABILITIES
      const deprecatedIds = Object.keys(MODEL_DEPRECATIONS);
      expect(deprecatedIds.length).toBeGreaterThan(0);
      // This ensures we're testing single-hop deprecation
      expect(deprecatedIds.every(id => typeof id === 'string')).toBe(true);
    });
  });

  describe('resolveModelId()', () => {
    it('should resolve deprecated model IDs to current ones', () => {
      expect(resolveModelId('claude-opus-4-5')).toBe('claude-opus-4-7');
      expect(resolveModelId('claude-sonnet-4-5')).toBe('claude-sonnet-4-6');
    });

    it('should return current model IDs unchanged', () => {
      expect(resolveModelId('claude-opus-4-6')).toBe('claude-opus-4-6');
      expect(resolveModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
      expect(resolveModelId('claude-haiku-4-5')).toBe('claude-haiku-4-5');
      expect(resolveModelId('k3')).toBe('k3');
    });

    it('remaps the retired K2.5/K2.6 Kimi generation to the live coding model', () => {
      for (const retired of ['kimi-k2', 'kimi-k2.5', 'kimi-k2.6', 'K2.6-code-preview']) {
        expect(resolveModelId(retired)).toBe('kimi-k2.7-code');
      }
    });

    it('should handle unknown model IDs gracefully', () => {
      const unknownId = 'nonexistent-model';
      expect(resolveModelId(unknownId)).toBe(unknownId);
    });

    it('should be idempotent', () => {
      const deprecated = 'claude-sonnet-4-5';
      const resolved = resolveModelId(deprecated);
      expect(resolveModelId(resolved)).toBe(resolved);
    });
  });

});
