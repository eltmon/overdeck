/**
 * Running the test-skip gate across a workspace's repository roots (PAN-3906).
 *
 * Separate from `test-skip-gate.ts` (the diff rules) and `test-skip-waiver.ts`
 * (the operator override) so the verification runner calls one function instead
 * of carrying the loop, the waiver lookup, and the evidence formatting itself.
 */
import { formatAnchorShort } from '../git-utils.js';
import { runTestSkipGate, type TestSkipViolation } from './test-skip-gate.js';
import { resolveActiveTestSkipWaiverSync } from './test-skip-waiver.js';

/** The subset of a resolved workspace repo root the gate needs. */
export interface TestSkipRepoRoot {
  repoKey: string;
  dir: string;
  targetBranch: string;
  isPolyrepo?: boolean;
}

export interface TestSkipGateEvaluation {
  /** True when the gate must fail: a diff error, or any non-advisory violation. */
  failed: boolean;
  /** Gate output: diff errors, the waiver if one applied, then every violation. */
  evidence: string;
  /** First diff error, when the gate could not inspect a diff at all. */
  error?: string;
  /** An operator waiver covered this head and demoted `removed-test` to evidence. */
  waiverApplied: boolean;
}

/**
 * PR #3872 finding 6: the gate runs once per repository root and violations
 * aggregate, so a skipped test in a secondary repo cannot slip past it.
 */
export async function evaluateTestSkipGate(
  issueId: string,
  roots: readonly TestSkipRepoRoot[],
  head: string | undefined,
): Promise<TestSkipGateEvaluation> {
  const waiver = resolveActiveTestSkipWaiverSync(issueId, head);
  const violations: TestSkipViolation[] = [];
  const errors: string[] = [];
  for (const root of roots) {
    const outcome = await runTestSkipGate(root.dir, `origin/${root.targetBranch}`, {
      waiveRemovedTests: waiver !== null,
    });
    if (outcome.error) errors.push(`${root.repoKey}: ${outcome.error}`);
    violations.push(...outcome.violations.map(v => ({
      ...v,
      file: root.isPolyrepo ? `${root.repoKey}/${v.file}` : v.file,
    })));
  }

  const evidence = [
    ...errors,
    ...(waiver
      ? [`waiver: removed tests waived by ${waiver.by ?? 'operator'} at ${waiver.at} for ${formatAnchorShort(waiver.sha)} — ${waiver.reason}`]
      : []),
    ...violations.map(v => `${v.file}: [${v.kind}] ${v.line}${v.advisory ? ' (evidence only — not a gate failure)' : ''}`),
  ].join('\n');

  return {
    failed: errors.length > 0 || violations.some(v => v.advisory !== true),
    evidence,
    ...(errors[0] ? { error: errors[0] } : {}),
    waiverApplied: waiver !== null,
  };
}
