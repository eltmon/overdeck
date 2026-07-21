/**
 * PAN-2372 WI-5 / FR-8: the swarm.infer_completion default flipped from 'nudge'
 * to 'auto'. loadCloisterConfigSync resolves an absent config file (and any
 * unset field) against DEFAULT_CLOISTER_CONFIG, so asserting the default export
 * is the deterministic proof that a fresh install converges a stalled slot after
 * one nudge + two stable observations instead of nudging forever. (The
 * swarmInferCompletionMode() fallback + explicit opt-out semantics are covered in
 * deacon-swarm-stall.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOISTER_CONFIG } from '../../../../src/lib/cloister/config.js';

describe('PAN-2372 WI-5 swarm infer_completion default (FR-8)', () => {
  it('defaults infer_completion to auto', () => {
    expect(DEFAULT_CLOISTER_CONFIG.swarm.infer_completion).toBe('auto');
  });
});
