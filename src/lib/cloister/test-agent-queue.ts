/**
 * Direct dispatch logic for triggering the test role after review passes.
 *
 * Test and browser UAT now run inside the role-based `test` run. There is no
 * separate UAT specialist and no per-project test-agent specialist pool.
 */

import { Data, Effect } from 'effect';
import { spawnRun } from '../agents.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { getPrFacts } from './pr-facts.js';
import { clearTestVerdictArtifact } from './test-verdict.js';

export function buildTestRolePrompt(options: {
  issueId: string;
  workspace?: string;
  branch?: string;
}): string {
  const workspaceLine = options.workspace ? `WORKSPACE: ${options.workspace}` : 'WORKSPACE: resolve from the run state';
  const branchLine = options.branch ? `BRANCH: ${options.branch}` : `BRANCH: feature/${options.issueId.toLowerCase()}`;
  return `TEST TASK for ${options.issueId}:

${workspaceLine}
${branchLine}

Run the role-based verification flow for this already-reviewed branch.

Required steps:
1. Before every repository command, verify you are in the workspace above with \`pwd\`. If not, stop and switch back to that workspace before continuing.
2. Work only in the workspace above. Never run build, test, git, or dashboard commands from the main checkout or another worktree.
3. Read the canonical xBRIEF under .pan/specs/ for ${options.issueId}, its checklist state in .pan/continues/${options.issueId.toUpperCase()}.xbrief.json, the pull request, issue notes, and project instructions to determine required verification.
4. Run the configured project gates (at minimum typecheck, lint, and tests when present/applicable).
5. Decide whether browser UAT is required from acceptance criteria, issue notes, PR notes, or UI/dashboard wording.
6. If UAT is required, build and run the dashboard from the workspace above, not from main. If a dashboard from another checkout is already running, stop it and start the workspace-built dashboard.
7. If UAT is required, use the Playwright MCP tools available to the test role. Do not spawn or wake a separate UAT agent.
8. Record automated gates and browser UAT as separate verdicts. The top-level status is ONLY the configured automated-gate result. When UAT is required, add uatStatus and uatNotes; omit both when UAT is not required. FIRST write .pan/test/result.json so the pipeline can recover both verdicts if the signal is interrupted:
   {"status":"passed","notes":"<automated gate evidence>","uatStatus":"passed","uatNotes":"<browser paths and evidence>"}
   Allowed values for status and uatStatus are "passed" or "failed". A required UAT that cannot run or leaves any criterion unproven is uatStatus "failed", even when status is "passed". Create .pan/test/ if needed and write this artifact BEFORE signaling the verdict.
9. Signal the same separate verdicts through the local trusted CLI, never by an unauthenticated HTTP request. Examples:
   Automated gates pass and required UAT passes:
   pan admin specialists done test ${options.issueId} --status passed --notes "<automated gate evidence>" --uat-status passed --uat-notes "<browser evidence>"
   Automated gates pass but required UAT fails or cannot run:
   pan admin specialists done test ${options.issueId} --status passed --notes "<automated gate evidence>" --uat-status failed --uat-notes "<blocking condition and exact unmet criteria>"
   Automated gates fail (include UAT flags too if UAT was attempted):
   pan admin specialists done test ${options.issueId} --status failed --notes "<failing commands and output>"
10. Make exactly ONE CLI signal attempt. If it fails, the .pan/test/result.json artifact from step 8 is the durable verdict and the deacon recovers from it — do NOT retry the signal in a loop. Report the failure in your summary and stop.
11. Report TESTS PASSED only when automated gates and required UAT passed. Otherwise report TESTS FAILED with commands run, UAT paths exercised, and concise evidence.

Boundaries:
- Do NOT edit code, tests, fixtures, snapshots, or configuration.
- Do NOT commit, push, merge, close issues, or call any merge endpoint.
- Do NOT spawn, wake, or delegate to test-agent or uat-agent specialists.`;
}

// ─── Effect variant (PAN-1249) ───────────────────────────────────────────────

/** A test-role dispatch error — wraps spawnRun failures. */
export class TestDispatchError extends Data.TaggedError('TestDispatchError')<{
  readonly issueId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface DispatchTestAgentResult {
  readonly delivered: boolean;
  readonly notified: boolean;
  readonly runId?: string;
  readonly reason?: 'no-project' | 'no-open-pr' | 'already-running' | 'spawn-failed';
}

/**
 * Effect variant of {@link dispatchTestAgentAndNotify}. Same semantics as the
 * Promise version, but failures funnel through a typed error channel. The
 * `notifyAgent` step is allowed to fail without failing the outer Effect — its
 * outcome is reported via {@link DispatchTestAgentResult.notified}.
 */
export const dispatchTestAgentAndNotify = (
  issueId: string,
  workspace?: string,
  branch?: string,
  notifyAgent?: (agentId: string, msg: string) => Promise<void>,
): Effect.Effect<DispatchTestAgentResult> =>
  Effect.gen(function* () {
    const resolved = yield* Effect.sync(() => resolveProjectFromIssueSync(issueId));
    if (!resolved) {
      console.error(`[test-dispatch] No project configured for ${issueId} — cannot spawn test role. Add it to projects.yaml.`);
      return { delivered: false, notified: false, reason: 'no-project' as const };
    }

    // Clear any stale verdict artifact so a previous cycle's result.json can
    // never be misread by the deacon failsafe as this dispatch's verdict (H3).
    if (workspace) yield* Effect.sync(() => clearTestVerdictArtifact(workspace));

    const prompt = buildTestRolePrompt({ issueId, workspace, branch });

    // PAN-3917 (FR-8): the test role runs against a pull request. No open PR —
    // nothing to test yet; already merged — nothing left to test.
    const facts = yield* Effect.promise(() => getPrFacts(issueId));
    if (!facts.open) {
      const why = facts.merged ? 'its PR already merged' : 'it has no open pull request';
      console.log(`[test-dispatch] Skipping test dispatch for ${issueId} — ${why}`);
      return { delivered: false, notified: false, reason: 'no-open-pr' as const };
    }

    const spawnProgram: Effect.Effect<DispatchTestAgentResult, never> = Effect.tryPromise({
      try: () => spawnRun(issueId, 'test', { workspace, prompt, startedBy: 'test-agent-queue' }),
      catch: (cause) => {
        const msg = cause instanceof Error ? cause.message : String(cause);
        return new TestDispatchError({ issueId, message: msg, cause });
      },
    }).pipe(
      Effect.matchEffect({
        onFailure: (err: TestDispatchError) => {
          // "already running" is non-fatal — treat as delivered.
          if (err.message.includes('already running')) {
            return Effect.sync((): DispatchTestAgentResult => {
              console.log(`[test-dispatch] Test role already running for ${issueId}`);
              return {
                delivered: true,
                notified: false,
                reason: 'already-running',
              };
            });
          }
          return Effect.sync((): DispatchTestAgentResult => {
            console.error(`[test-dispatch] Failed to dispatch test role for ${issueId}: ${err.message}`);
            return {
              delivered: false,
              notified: false,
              reason: 'spawn-failed',
            };
          });
        },
        onSuccess: (run) =>
          Effect.sync((): DispatchTestAgentResult => {
            console.log(`[test-dispatch] Started test role for ${issueId} (${run.id})`);
            return {
              delivered: true,
              notified: false,
              runId: run.id,
            };
          }),
      }),
    );

    const spawnResult: DispatchTestAgentResult = yield* spawnProgram;

    if (spawnResult.delivered && notifyAgent) {
      const notified = yield* Effect.tryPromise({
        try: () =>
          notifyAgent(
            `agent-${issueId.toLowerCase()}`,
            `REVIEW PASSED for ${issueId}. The test role has been dispatched automatically. Do NOT poll or check status — you will be notified when tests complete.`,
          ).then(() => true),
        catch: (err) => {
          console.log(
            `[test-dispatch] Could not notify work agent for ${issueId} (may not be running): ${(err as Error).message}`,
          );
          return false;
        },
      }).pipe(Effect.orElseSucceed(() => false));
      return { ...spawnResult, notified };
    }

    return spawnResult;
  });
