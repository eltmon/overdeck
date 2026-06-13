import { describe, expect, it } from 'vitest';
import {
  detectTestRequirements,
  TEST_REQUIREMENT_KEYWORDS,
  type TestRequirement,
} from '../test-requirement-gate.js';

describe('detectTestRequirements', () => {
  it('returns an empty array for empty, null, or undefined input (AC4)', () => {
    expect(detectTestRequirements('')).toEqual([]);
    expect(detectTestRequirements(null)).toEqual([]);
    expect(detectTestRequirements(undefined)).toEqual([]);
  });

  it('exports the exact keyword set the orchestrator and tests share (AC1/AC2)', () => {
    const keywords = TEST_REQUIREMENT_KEYWORDS.map((k) => k.keyword);
    expect(keywords).toEqual([
      'test',
      'regression test',
      'unit test',
      'Test:',
      '## Test plan',
      'vitest',
      'playwright',
    ]);
  });

  it('matches the bare word "test" case-insensitively (AC2)', () => {
    const results = detectTestRequirements('We need a test for this.');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject<TestRequirement>({
      keyword: 'test',
      line: 1,
      context: 'We need a test for this.',
    });
  });

  it('matches "regression test" (AC2)', () => {
    const results = detectTestRequirements('- [ ] Regression test for the retry bug');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.keyword === 'regression test')).toBe(true);
  });

  it('matches "unit test" (AC2)', () => {
    const results = detectTestRequirements('Add a unit test for the helper.');
    expect(results.some((r) => r.keyword === 'unit test')).toBe(true);
  });

  it('matches "Test:" (AC2)', () => {
    const results = detectTestRequirements('Test: ensure the guard blocks pan done.');
    expect(results.some((r) => r.keyword === 'Test:')).toBe(true);
  });

  it('matches "## Test plan" (AC2)', () => {
    const results = detectTestRequirements('## Test plan\n\n1. Run the unit tests.');
    expect(results.some((r) => r.keyword === '## Test plan')).toBe(true);
  });

  it('matches "vitest" (AC2)', () => {
    const results = detectTestRequirements('Add a vitest spec for the parser.');
    expect(results.some((r) => r.keyword === 'vitest')).toBe(true);
  });

  it('matches "playwright" (AC2)', () => {
    const results = detectTestRequirements('Add a Playwright flow for the login page.');
    expect(results.some((r) => r.keyword === 'playwright')).toBe(true);
  });

  it('reports multiple matches on the same line (AC2)', () => {
    const results = detectTestRequirements('Add a unit test and a playwright regression test.');
    const keywords = results.map((r) => r.keyword);
    expect(keywords).toContain('unit test');
    expect(keywords).toContain('playwright');
    expect(keywords).toContain('regression test');
  });

  it('reports accurate 1-indexed line numbers (AC5)', () => {
    const text = 'first line\nsecond line asks for a test\nthird line';
    const results = detectTestRequirements(text);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ keyword: 'test', line: 2, context: 'second line asks for a test' });
  });

  it('does not match "test" inside unrelated words (AC3)', () => {
    expect(detectTestRequirements('This is the latest version.')).toEqual([]);
    expect(detectTestRequirements('The issue is contested.')).toEqual([]);
    expect(detectTestRequirements('It has already been tested.')).toEqual([]);
  });
});
