/**
 * PAN-3847 W14 — the test-skip gate flags diffs that add skipped/only tests or
 * remove test cases.
 */
import { describe, expect, it } from 'vitest';

import { findTestSkipViolations } from '../../../../src/lib/cloister/test-skip-gate.js';

function diffFor(file: string, lines: string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1,1 +1,1 @@',
    ...lines,
  ].join('\n');
}

describe('findTestSkipViolations (PAN-3847)', () => {
  it('flags an added it.skip( in a test file', () => {
    const diff = diffFor('src/foo.test.ts', ['+  it.skip("does the thing", () => {']);

    const violations = findTestSkipViolations(diff);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: 'src/foo.test.ts', kind: 'skip' });
  });

  it('flags a conversion from it( to xit( exactly once (not also as a removal)', () => {
    const diff = diffFor('src/foo.test.ts', [
      '-  it("does the thing", () => {',
      '+  xit("does the thing", () => {',
    ]);

    const violations = findTestSkipViolations(diff);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('skip');
  });

  it('flags an added describe.only( as an only violation', () => {
    const diff = diffFor('src/foo.spec.ts', ['+describe.only("suite", () => {']);

    const violations = findTestSkipViolations(diff);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('only');
  });

  it('flags removing two it( calls while adding one as removed-test', () => {
    const diff = diffFor('src/foo.test.ts', [
      '-  it("first", () => {',
      '-  it("second", () => {',
      '+  it("merged", () => {',
    ]);

    const violations = findTestSkipViolations(diff);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: 'src/foo.test.ts', kind: 'removed-test' });
  });

  it('ignores diffs that touch only non-test files', () => {
    const diff = diffFor('src/foo.ts', [
      '+  it.skip("looks like a test but is not in a test file", () => {',
      '-  it("removed", () => {',
    ]);

    expect(findTestSkipViolations(diff)).toEqual([]);
  });

  it('ignores removed skip lines and context lines entirely', () => {
    const diff = diffFor('src/foo.test.ts', [
      '-  it.skip("removed skip is fine", () => {',
      '   it("context line is untouched", () => {',
    ]);

    expect(findTestSkipViolations(diff)).toEqual([]);
  });
});
