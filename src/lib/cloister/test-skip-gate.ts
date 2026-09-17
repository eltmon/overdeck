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
const SKIP_OR_ONLY = /\b(?:it|test|describe)\.(skip|only)\s*\(|\bx(?:it|test|describe)\s*\(/;
// For the removed/added balance, disabled test calls (xit/xtest) still count as
// test calls — converting it( → xit( is a 'skip' violation, not a removal.
const TEST_CALL = /^\s*x?(?:it|test)\s*\(/;

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
        }
        if (TEST_CALL.test(line)) addedTestCalls += 1;
      } else if (rawLine.startsWith('-')) {
        if (TEST_CALL.test(rawLine.slice(1))) removedTestCalls += 1;
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
  /** True when the diff could not be computed — the gate abstains rather than blocks. */
  diffUnavailable?: boolean;
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
  } catch {
    // No base ref (fresh clone, offline) — abstain like the empty-changeset guard.
    return { passed: true, violations: [], diffUnavailable: true };
  }
  const violations = findTestSkipViolations(diff);
  return { passed: violations.length === 0, violations };
}
