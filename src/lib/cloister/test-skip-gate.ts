/**
 * Test-skip gate (PAN-3847, FR-12).
 *
 * Runs before the quality gates in the verification runner: a diff that adds
 * `.skip`/`.only`/`xit`/`xdescribe`/`xtest` in test files, or removes more
 * `it(`/`test(` calls than it adds, fails verification as a required gate
 * named `test-skip` — the gate output is the evidence, one line per violation.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface TestSkipViolation {
  file: string;
  line: string;
  kind: 'skip' | 'only' | 'removed-test';
}

const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
// Direct forms: it.skip(/test.only(/xdescribe(. Conditional forms (PR #3872
// finding 3): it.skipIf(cond)( / describe.skipIf(cond)( and a { skip: true }
// options argument — vitest skips those too.
const SKIP_OR_ONLY = /\b(?:it|test|describe)\.(skip|only)\s*\(|\bx(?:it|test|describe)\s*\(/;
const CONDITIONAL_SKIP = /\b(?:it|test|describe)\.skipIf\s*\(|\{\s*skip:\s*true\s*\}/;
// For the removed/added balance: added lines count every test-call form
// (plain, disabled xit/xtest, and chained modifiers like it.skipIf() — PR #3872
// finding 3); removed lines count only plain calls, so deleting an already-
// skipped test is not itself a 'removed-test' violation.
const TEST_CALL_ADDED = /^\s*x?(?:it|test)(?:\.[a-zA-Z]+)*\s*\(/;
const TEST_CALL_REMOVED = /^\s*x?(?:it|test)\s*\(/;

export function findTestSkipViolations(unifiedDiff: string): TestSkipViolation[] {
  const violations: TestSkipViolation[] = [];
  for (const block of unifiedDiff.split(/^(?=diff --git )/m)) {
    const header = /^diff --git a\/\S+ b\/(\S+)/m.exec(block);
    if (!header) continue;
    const file = header[1]!;
    if (!TEST_FILE.test(file)) continue;

    let removedTestCalls = 0;
    let addedTestCalls = 0;
    for (const rawLine of block.split('\n')) {
      if (rawLine.startsWith('+++') || rawLine.startsWith('---')) continue;
      if (rawLine.startsWith('+')) {
        const line = rawLine.slice(1);
        const skipMatch = SKIP_OR_ONLY.exec(line);
        if (skipMatch) {
          violations.push({ file, line: line.trim(), kind: skipMatch[1] === 'only' ? 'only' : 'skip' });
        } else if (CONDITIONAL_SKIP.test(line)) {
          violations.push({ file, line: line.trim(), kind: 'skip' });
        }
        if (TEST_CALL_ADDED.test(line)) addedTestCalls += 1;
      } else if (rawLine.startsWith('-')) {
        if (TEST_CALL_REMOVED.test(rawLine.slice(1))) removedTestCalls += 1;
      }
    }
    if (removedTestCalls > addedTestCalls) {
      violations.push({
        file,
        line: `${removedTestCalls - addedTestCalls} test call(s) removed (${removedTestCalls} removed, ${addedTestCalls} added)`,
        kind: 'removed-test',
      });
    }
  }
  return violations;
}

export interface TestSkipGateOutcome {
  passed: boolean;
  violations: TestSkipViolation[];
  /** True when the diff could not be computed — the gate FAILS with `error` as output (PR #3872 finding 4). */
  diffUnavailable?: boolean;
  /** Diagnostic for a diff failure (missing origin/<target>, git error, timeout). */
  error?: string;
}

export async function runTestSkipGate(workspacePath: string, changedBase: string): Promise<TestSkipGateOutcome> {
  let diff: string;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '-U0', `${changedBase}...HEAD`],
      { cwd: workspacePath, encoding: 'utf-8', timeout: 30_000 },
    );
    diff = stdout;
  } catch (err) {
    // PR #3872 finding 4: a gate that cannot inspect the diff must not wave a
    // skipped test through — fail closed with the diagnostic.
    const message = err instanceof Error ? err.message.split('\n')[0]! : String(err);
    return { passed: false, violations: [], diffUnavailable: true, error: `Could not diff ${changedBase}...HEAD: ${message}` };
  }
  const violations = findTestSkipViolations(diff);
  return { passed: violations.length === 0, violations };
}
