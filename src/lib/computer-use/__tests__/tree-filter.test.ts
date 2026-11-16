import { describe, expect, it } from 'vitest';

import { filterTree } from '../tree-filter.js';

const TREE = [
  '0 window ghostty',
  '\t1 panel toolbar',
  '\t\t2 button New Tab',
  '\t1 panel ~/Projects/overdeck',
  '\t\t3 panel editor',
  '\t\t\t4 text main.ts',
  '\t\t5 panel sidebar',
  '\t\t\t6 text main.ts',
];

describe('filterTree (PAN-5452)', () => {
  it('keeps a deep match plus every ancestor up to the root, in order (ac1)', () => {
    expect(filterTree(TREE, 'editor')).toEqual([
      '0 window ghostty',
      '\t1 panel ~/Projects/overdeck',
      '\t\t3 panel editor',
    ]);
  });

  it('keeps shared ancestors exactly once when several matches share them (ac2)', () => {
    const result = filterTree(TREE, 'main.ts');
    expect(result).toEqual([
      '0 window ghostty',
      '\t1 panel ~/Projects/overdeck',
      '\t\t3 panel editor',
      '\t\t\t4 text main.ts',
      '\t\t5 panel sidebar',
      '\t\t\t6 text main.ts',
    ]);
    // Only one copy of the root and the shared depth-1 ancestor.
    expect(result.filter((line) => line === '0 window ghostty')).toHaveLength(1);
    expect(result.filter((line) => line.endsWith('~/Projects/overdeck'))).toHaveLength(1);
  });

  it('caps matching lines at maxElements, counting only matches (ac3)', () => {
    const lines = ['0 window app', ...Array.from({ length: 5 }, (_, i) => `\t${i + 1} button item ${i}`)];
    const result = filterTree(lines, 'item', 2);
    const matches = result.filter((line) => line.includes('item'));
    expect(matches).toHaveLength(2);
    expect(result).toContain('0 window app');
  });

  it('returns the no-match message when nothing matches (ac4)', () => {
    expect(filterTree(TREE, 'nope')).toEqual(['No element matches "nope".']);
  });

  it('matches case-insensitively', () => {
    expect(filterTree(TREE, 'EDITOR')).toContain('\t\t3 panel editor');
  });

  it('never duplicates a line kept as both a match and another match\'s ancestor', () => {
    const result = filterTree(TREE, 'panel');
    expect(result.length).toBe(new Set(result).size);
  });
});
