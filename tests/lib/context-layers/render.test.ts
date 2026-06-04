/**
 * Managed-region rendering for harness CLAUDE.md files (PAN-1201).
 */

import { describe, it, expect } from 'vitest';
import {
  applyManagedRegion,
  hasManagedRegion,
  userContentOutsideRegion,
  REGION_BEGIN,
  REGION_END,
} from '../../../src/lib/context-layers/render.js';

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

describe('hasManagedRegion', () => {
  it('is false for a hand-authored file with no region', () => {
    expect(hasManagedRegion('# My CLAUDE.md\n\njust my stuff')).toBe(false);
    expect(hasManagedRegion('')).toBe(false);
  });

  it('is true once a region has been injected', () => {
    expect(hasManagedRegion(applyManagedRegion('mine', 'managed'))).toBe(true);
  });
});

describe('userContentOutsideRegion', () => {
  it('returns the whole file when there is no region', () => {
    expect(userContentOutsideRegion('# Mine\n\nbody')).toBe('# Mine\n\nbody');
  });

  it('is empty for a region-only file', () => {
    expect(userContentOutsideRegion(applyManagedRegion('', 'managed'))).toBe('');
  });

  it('returns only the hand-authored content when a region is present', () => {
    const withRegion = applyManagedRegion('# Mine\n\nhand-written.', 'managed body');
    expect(userContentOutsideRegion(withRegion)).toBe('# Mine\n\nhand-written.');
  });
});
