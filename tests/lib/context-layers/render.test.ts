/**
 * Managed-region rendering for harness CLAUDE.md files (PAN-1201).
 */

import { describe, it, expect } from 'vitest';
import { applyManagedRegion, REGION_BEGIN, REGION_END } from '../../../src/lib/context-layers/render.js';

const countRegions = (s: string): number => s.split(REGION_BEGIN).length - 1;

describe('applyManagedRegion', () => {
  it('creates a managed region in an empty file', () => {
    const out = applyManagedRegion('', 'managed body');
    expect(out).toContain(REGION_BEGIN);
    expect(out).toContain('managed body');
    expect(out).toContain(REGION_END);
  });

  it('appends the region after existing hand-authored content', () => {
    const out = applyManagedRegion('# My own CLAUDE.md\n\nhand-written.', 'managed body');
    expect(out).toContain('hand-written.');
    expect(out.indexOf('hand-written.')).toBeLessThan(out.indexOf(REGION_BEGIN));
  });

  it('replaces an existing region while preserving content outside it', () => {
    const first = applyManagedRegion('user content', 'v1');
    const second = applyManagedRegion(first, 'v2');
    expect(second).toContain('user content');
    expect(second).toContain('v2');
    expect(second).not.toContain('v1');
    expect(countRegions(second)).toBe(1);
  });

  it('is idempotent for identical managed content', () => {
    const once = applyManagedRegion('user', 'body');
    const twice = applyManagedRegion(once, 'body');
    expect(twice).toBe(once);
  });
});
