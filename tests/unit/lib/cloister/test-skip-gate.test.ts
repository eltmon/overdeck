/**
 * PAN-3847 W14 — the test-skip gate flags diffs that add skipped/only tests or
 * remove test cases. PAN-3906 — removals balance across the whole diff, a test
 * file deleted with its subject is exempt, and an operator waiver demotes
 * `removed-test` to evidence.
 */
import { describe, expect, it } from 'vitest';

import { applyTestRemovalWaiver, findTestSkipViolations } from '../../../../src/lib/cloister/test-skip-gate.js';
import { waiverCoversHead } from '../../../../src/lib/cloister/test-skip-waiver.js';

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

describe('conditional skip forms (PR #3872 finding 3)', () => {
  it('flags it.skipIf(cond)( as a skip violation', () => {
    const diff = diffFor('src/foo.test.ts', ['+  it.skipIf(isCI)("does the thing", () => {']);

    const violations = findTestSkipViolations(diff);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: 'src/foo.test.ts', kind: 'skip' });
  });

  it('flags describe.skipIf(cond)( as a skip violation', () => {
    const diff = diffFor('src/foo.test.ts', ['+describe.skipIf(process.env.CI)("suite", () => {']);

    expect(findTestSkipViolations(diff)).toHaveLength(1);
  });

  it('flags a { skip: true } options argument as a skip violation', () => {
    const diff = diffFor('src/foo.test.ts', ['+  it("does the thing", { skip: true }, () => {']);

    const violations = findTestSkipViolations(diff);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('skip');
  });

  it('does not flag { skip: false } or unrelated options', () => {
    const diff = diffFor('src/foo.test.ts', ['+  it("does the thing", { skip: false, timeout: 1000 }, () => {']);

    expect(findTestSkipViolations(diff)).toEqual([]);
  });

  it('conditional skips still count as test calls for the removed-test balance', () => {
    const diff = diffFor('src/foo.test.ts', [
      '-  it("first", () => {',
      '+  it.skipIf(isCI)("first", () => {',
    ]);

    const violations = findTestSkipViolations(diff);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('skip');
  });
});

describe('diff-unavailable fails the gate (PR #3872 finding 4)', () => {
  it('returns passed: false with a diagnostic when git diff fails', async () => {
    const { runTestSkipGate } = await import('../../../../src/lib/cloister/test-skip-gate.js');

    const outcome = await runTestSkipGate('/nonexistent-workspace-dir-3847', 'origin/main');

    expect(outcome.passed).toBe(false);
    expect(outcome.diffUnavailable).toBe(true);
    expect(outcome.error).toContain('origin/main...HEAD');
  });
});

describe('options-object skip scoping (PR #3872 round 2 finding 3)', () => {
  it('flags skip: true at any position in the options object', () => {
    const diff = diffFor('src/foo.test.ts', ['+  it("x", { timeout: 1000, skip: true }, () => {']);

    const violations = findTestSkipViolations(diff);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: 'src/foo.test.ts', kind: 'skip' });
  });

  it('does not flag an unrelated { skip: true } object literal', () => {
    const diff = diffFor('src/foo.test.ts', ['+const fixture = { skip: true };']);

    expect(findTestSkipViolations(diff)).toEqual([]);
  });

  it('does not flag skip: true inside a test NAME string without an options object', () => {
    const diff = diffFor('src/foo.test.ts', ['+  it("handles { skip: true } payloads", () => {']);

    expect(findTestSkipViolations(diff)).toEqual([]);
  });
});

describe('removed-call counting (PR #3872 round 2 finding 4)', () => {
  it('deleting an xit( is not a removed-test violation', () => {
    const diff = diffFor('src/foo.test.ts', [
      '-  xit("already skipped", () => {',
    ]);

    expect(findTestSkipViolations(diff)).toEqual([]);
  });

  it('converting it( to xit( still counts as exactly one skip violation, not a removal', () => {
    const diff = diffFor('src/foo.test.ts', [
      '-  it("does the thing", () => {',
      '+  xit("does the thing", () => {',
    ]);

    const violations = findTestSkipViolations(diff);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('skip');
  });
});

// ─── PAN-3906: whole-diff balance, deleted-subject exemption, operator waiver ──

/** A diff block for a file deleted whole, shaped like real `git diff -U0` output. */
function deletedFileDiff(file: string, lines: string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    'deleted file mode 100644',
    'index c4f27aebd8d..00000000000',
    `--- a/${file}`,
    '+++ /dev/null',
    `@@ -1,${lines.length} +0,0 @@`,
    ...lines,
  ].join('\n');
}

describe('whole-diff removed/added balance (PAN-3906)', () => {
  it('passes a net removal in one file when another file adds more tests', () => {
    const diff = [
      diffFor('src/old.test.ts', ['-  it("first", () => {', '-  it("second", () => {']),
      diffFor('src/new.test.ts', ['+  it("a", () => {', '+  it("b", () => {', '+  it("c", () => {']),
    ].join('\n');

    const violations = findTestSkipViolations(diff);

    expect(violations.every(v => v.advisory === true)).toBe(true);
  });

  it('still emits the per-file evidence line when the total is balanced', () => {
    const diff = [
      diffFor('src/old.test.ts', ['-  it("first", () => {', '-  it("second", () => {']),
      diffFor('src/new.test.ts', ['+  it("a", () => {', '+  it("b", () => {', '+  it("c", () => {']),
    ].join('\n');

    const violations = findTestSkipViolations(diff);

    expect(violations).toEqual([{
      file: 'src/old.test.ts',
      line: '2 test call(s) removed (2 removed, 0 added)',
      kind: 'removed-test',
      advisory: true,
    }]);
  });

  it('fails when the diff removes more test calls than it adds overall', () => {
    const diff = [
      diffFor('src/old.test.ts', ['-  it("first", () => {', '-  it("second", () => {', '-  it("third", () => {']),
      diffFor('src/new.test.ts', ['+  it("a", () => {']),
    ].join('\n');

    const violations = findTestSkipViolations(diff);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: 'src/old.test.ts', kind: 'removed-test' });
    expect(violations[0]!.advisory).toBeUndefined();
  });

  it('an added .skip still fails even when the whole-diff balance is positive', () => {
    const diff = [
      diffFor('src/a.test.ts', ['+  it.skip("disabled", () => {', '+  it("b", () => {', '+  it("c", () => {']),
      diffFor('src/b.test.ts', ['-  it("gone", () => {']),
    ].join('\n');

    const violations = findTestSkipViolations(diff);

    expect(violations.filter(v => v.advisory !== true)).toHaveLength(1);
    expect(violations.find(v => v.advisory !== true)).toMatchObject({ kind: 'skip' });
  });
});

describe('deleted-subject exemption (PAN-3906)', () => {
  it('exempts a deleted __tests__ file whose subject module is deleted too', () => {
    const diff = [
      deletedFileDiff('src/components/__tests__/NewProjectModal.test.tsx', [
        '-  it("one", () => {',
        '-  it("two", () => {',
      ]),
      deletedFileDiff('src/components/NewProjectModal.tsx', ['-export function NewProjectModal() {}']),
    ].join('\n');

    expect(findTestSkipViolations(diff)).toEqual([]);
  });

  it('exempts a deleted sibling test file whose subject module is deleted too', () => {
    const diff = [
      deletedFileDiff('src/lib/dead.test.ts', ['-  it("one", () => {']),
      deletedFileDiff('src/lib/dead.ts', ['-export const dead = 1;']),
    ].join('\n');

    expect(findTestSkipViolations(diff)).toEqual([]);
  });

  it('does not exempt a deleted test file whose subject module survives', () => {
    const diff = deletedFileDiff('src/lib/alive.test.ts', ['-  it("one", () => {']);

    const violations = findTestSkipViolations(diff);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: 'src/lib/alive.test.ts', kind: 'removed-test' });
    expect(violations[0]!.advisory).toBeUndefined();
  });

  it('keeps an exempt file out of the whole-diff total', () => {
    const diff = [
      deletedFileDiff('src/lib/dead.test.ts', ['-  it("one", () => {', '-  it("two", () => {']),
      deletedFileDiff('src/lib/dead.ts', ['-export const dead = 1;']),
      diffFor('src/lib/other.test.ts', ['-  it("renamed", () => {', '+  it("renamed better", () => {']),
    ].join('\n');

    expect(findTestSkipViolations(diff)).toEqual([]);
  });
});

describe('operator waiver demotes removed-test only (PAN-3906)', () => {
  it('turns a failing removed-test into evidence and leaves skip/only failing', () => {
    const diff = [
      diffFor('src/a.test.ts', ['-  it("one", () => {', '-  it("two", () => {']),
      diffFor('src/b.test.ts', ['+  it.only("focused", () => {']),
    ].join('\n');

    const waived = applyTestRemovalWaiver(findTestSkipViolations(diff));

    expect(waived.find(v => v.kind === 'removed-test')!.advisory).toBe(true);
    expect(waived.find(v => v.kind === 'only')!.advisory).toBeUndefined();
  });
});

describe('waiverCoversHead (PAN-3906)', () => {
  it('matches only the exact head the waiver was granted against', () => {
    const waiver = { sha: 'abc123', reason: 'component deleted', at: '2026-09-18T00:00:00.000Z' };

    expect(waiverCoversHead(waiver, 'abc123')).toBe(true);
    expect(waiverCoversHead(waiver, 'def456')).toBe(false);
    expect(waiverCoversHead(waiver, undefined)).toBe(false);
    expect(waiverCoversHead(undefined, 'abc123')).toBe(false);
  });
});

describe('waiver survives a record rebuild (PAN-3906)', () => {
  it('projectPipeline carries testSkipWaiver forward from the existing record', async () => {
    const { projectPipeline } = await import('../../../../src/lib/pan-dir/records.js');
    const testSkipWaiver = { sha: 'abc123', reason: 'component deleted', at: '2026-09-18T00:00:00.000Z', by: 'conv-7' };

    // The rebuild projects from ReviewStatus, which has no such field — without
    // an explicit carry-forward the waiver would be erased on the next write.
    expect(projectPipeline('PAN-1', null, {
      issueId: 'PAN-1',
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
      testSkipWaiver,
      updatedAt: '2026-09-18T00:00:00.000Z',
    }).testSkipWaiver).toEqual(testSkipWaiver);
  });
});
