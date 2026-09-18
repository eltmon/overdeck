/**
 * Test-skip gate (PAN-3847 FR-12; balance + exemptions PAN-3906).
 *
 * Runs before the quality gates in the verification runner. Two independent
 * rules, because they answer different questions:
 *
 *   - `.skip`/`.only`/`xit`/`xdescribe`/`xtest` ADDED in a test file is always
 *     a violation, per line. Disabling a test is never balanced by writing
 *     another one, and it is never waivable.
 *   - Removed `it(`/`test(` calls are balanced across the WHOLE diff, not per
 *     file (PAN-3906). A refactor that deletes one component's tests while
 *     adding more elsewhere is a net gain in coverage; failing it per-file
 *     meant any component deletion was unmergeable. Per-file lines are still
 *     emitted as evidence — they just do not fail the gate on their own.
 *
 * Two escapes exist for a genuine net removal:
 *   - Structural: a test file deleted whole whose subject module is deleted in
 *     the same diff is exempt — the tests went away because the code did.
 *   - Operator waiver: `pan verify waive-test-removal <id> --reason "…"` pins a
 *     waiver to one HEAD; see `test-skip-waiver.ts`. It waives `removed-test`
 *     only, never `skip`/`only`.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface TestSkipViolation {
  file: string;
  line: string;
  kind: 'skip' | 'only' | 'removed-test';
  /**
   * Evidence only: recorded in the gate output but not a failing violation
   * (PAN-3906) — a per-file removal the whole-diff balance absorbs, or a
   * `removed-test` an operator waiver covers.
   */
  advisory?: boolean;
}

const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const SOURCE_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx'] as const;
/** `git diff` marks a whole-file removal with this header line. */
const DELETED_FILE = /^deleted file mode /m;
// Direct forms: it.skip(/test.only(/xdescribe(. Conditional forms (PR #3872
// finding 3): it.skipIf(cond)( / describe.skipIf(cond)( and an options object
// with skip: true belonging to an it/test/describe call — any property order
// (round 2: it("x", { timeout, skip: true }, fn) must match; an unrelated
// 'const fixture = { skip: true }' must not).
const SKIP_OR_ONLY = /\b(?:it|test|describe)\.(skip|only)\s*\(|\bx(?:it|test|describe)\s*\(/;
const CONDITIONAL_SKIP = /\b(?:it|test|describe)\.skipIf\s*\(|\b(?:it|test|describe)(?:\.[a-zA-Z]+)*\s*\(\s*['"`][^'"`]*['"`]\s*,\s*\{[^{}]*\bskip:\s*true\b/;
// For the removed/added balance: added lines count every test-call form
// (plain, disabled xit/xtest, and chained modifiers like it.skipIf() — PR #3872
// finding 3); removed lines count only PLAIN calls, so deleting an already-
// skipped test (xit/xtest) is not itself a 'removed-test' violation (round 2:
// the x? in the removed pattern made a deleted xit() count — a contradiction).
const TEST_CALL_ADDED = /^\s*x?(?:it|test)(?:\.[a-zA-Z]+)*\s*\(/;
const TEST_CALL_REMOVED = /^\s*(?:it|test)\s*\(/;

/**
 * Paths the subject module of a test file could occupy: the same directory,
 * and — when the test sits in a `__tests__/` directory — its parent. Basename
 * and extension follow the codebase convention (`Foo.test.tsx` ⇒ `Foo.tsx`).
 */
export function subjectCandidatesForTestFile(testFile: string): string[] {
  const parsed = /^(.*?)([^/]+)\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/.exec(testFile);
  if (!parsed) return [];
  const dir = parsed[1]!;
  const base = parsed[2]!;
  const dirs = [dir];
  const testsDir = /^(.*?)__tests__\/$/.exec(dir);
  if (testsDir) dirs.push(testsDir[1]!);
  return dirs.flatMap(d => SOURCE_EXTENSIONS.map(ext => `${d}${base}.${ext}`));
}

interface DiffFileBlock {
  file: string;
  block: string;
  deleted: boolean;
}

function parseDiffBlocks(unifiedDiff: string): DiffFileBlock[] {
  const blocks: DiffFileBlock[] = [];
  for (const block of unifiedDiff.split(/^(?=diff --git )/m)) {
    const header = /^diff --git a\/\S+ b\/(\S+)/m.exec(block);
    if (!header) continue;
    blocks.push({ file: header[1]!, block, deleted: DELETED_FILE.test(block) });
  }
  return blocks;
}

export function findTestSkipViolations(unifiedDiff: string): TestSkipViolation[] {
  const blocks = parseDiffBlocks(unifiedDiff);
  const deletedPaths = new Set(blocks.filter(b => b.deleted).map(b => b.file));

  const violations: TestSkipViolation[] = [];
  const removalEvidence: TestSkipViolation[] = [];
  let totalRemoved = 0;
  let totalAdded = 0;

  for (const { file, block, deleted } of blocks) {
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

    // Structural exemption (PAN-3906): the test file was deleted whole and so
    // was the module it covered — the removal is the intended outcome, and it
    // must not consume the whole-diff balance other files depend on either.
    if (deleted && subjectCandidatesForTestFile(file).some(path => deletedPaths.has(path))) continue;

    totalRemoved += removedTestCalls;
    totalAdded += addedTestCalls;
    if (removedTestCalls > addedTestCalls) {
      removalEvidence.push({
        file,
        line: `${removedTestCalls - addedTestCalls} test call(s) removed (${removedTestCalls} removed, ${addedTestCalls} added)`,
        kind: 'removed-test',
      });
    }
  }

  const netRemovalAcrossDiff = totalRemoved > totalAdded;
  for (const evidence of removalEvidence) {
    violations.push(netRemovalAcrossDiff ? evidence : { ...evidence, advisory: true });
  }
  return violations;
}

/** Demote every `removed-test` violation to evidence; `skip`/`only` are never waivable. */
export function applyTestRemovalWaiver(violations: TestSkipViolation[]): TestSkipViolation[] {
  return violations.map(v => (v.kind === 'removed-test' ? { ...v, advisory: true } : v));
}

export interface TestSkipGateOutcome {
  passed: boolean;
  violations: TestSkipViolation[];
  /** True when the diff could not be computed — the gate FAILS with `error` as output (PR #3872 finding 4). */
  diffUnavailable?: boolean;
  /** Diagnostic for a diff failure (missing origin/<target>, git error, timeout). */
  error?: string;
}

export interface TestSkipGateOptions {
  /** An operator waiver covers this HEAD: `removed-test` becomes evidence only (PAN-3906). */
  waiveRemovedTests?: boolean;
}

export async function runTestSkipGate(
  workspacePath: string,
  changedBase: string,
  options: TestSkipGateOptions = {},
): Promise<TestSkipGateOutcome> {
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
  const found = findTestSkipViolations(diff);
  const violations = options.waiveRemovedTests ? applyTestRemovalWaiver(found) : found;
  return { passed: violations.every(v => v.advisory === true), violations };
}
