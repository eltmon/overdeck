/**
 * Direct dispatch logic for triggering the test role after review passes.
 *
 * Test and browser UAT now run inside the role-based `test` run. There is no
 * separate UAT specialist and no per-project test-agent specialist pool.
 */

import { Data, Effect } from 'effect';
import { setReviewStatus } from '../review-status.js';
import { spawnRun } from '../agents.js';
import { resolveProjectFromIssue } from '../projects.js';

function dashboardApiUrl(): string {
  const apiPort = process.env.API_PORT || process.env.PORT || '3011';
  return process.env.DASHBOARD_URL || `http://localhost:${apiPort}`;
}

export function buildTestRolePrompt(options: {
  issueId: string;
  workspace?: string;
  branch?: string;
  apiUrl?: string;
}): string {
  const workspaceLine = options.workspace ? `WORKSPACE: ${options.workspace}` : 'WORKSPACE: resolve from the run state';
  const branchLine = options.branch ? `BRANCH: ${options.branch}` : `BRANCH: feature/${options.issueId.toLowerCase()}`;
  const apiUrl = options.apiUrl ?? dashboardApiUrl();

  return `TEST TASK for ${options.issueId}:

${workspaceLine}
${branchLine}

Run the role-based verification flow for this already-reviewed branch.

Required steps:
1. Work only in the workspace above.
2. Read .pan/continue.json, .pan/spec.vbrief.json, issue notes, and project instructions to determine required verification.
3. Run the configured project gates (at minimum typecheck, lint, and tests when present/applicable).
4. Decide whether browser UAT is required from acceptance criteria, issue notes, PR notes, or UI/dashboard wording.
5. If UAT is required, use the Playwright MCP tools available to the test role. Do not spawn or wake a separate UAT agent.
6. On success, mark tests passed (the ship role handles merge preparation):
   curl -s -X POST ${apiUrl}/api/review/${options.issueId}/status \\
     -H "Content-Type: application/json" \\
     -d '{"testStatus":"passed"}'
7. On failure, mark tests failed with actionable notes:
   curl -s -X POST ${apiUrl}/api/review/${options.issueId}/status \\
     -H "Content-Type: application/json" \\
     -d '{"testStatus":"failed","testNotes":"<commands/UAT failures and exact unmet criteria>"}'
8. Report TESTS PASSED or TESTS FAILED with commands run, UAT paths exercised, and concise evidence.

Boundaries:
- Do NOT edit code, tests, fixtures, snapshots, or configuration.
- Do NOT commit, push, merge, close issues, or call any merge endpoint.
- Do NOT spawn, wake, or delegate to test-agent or uat-agent specialists.`;
}

/**
 * Spawn a role-based test run for the given issue, then notify the work agent
 * when delivery succeeds.
 *
 * @param issueId     - Issue identifier (e.g. "PAN-343")
 * @param workspace   - Absolute path to the workspace directory, when known
 * @param branch      - Feature branch name (e.g. "feature/pan-343"), when known
 * @param notifyAgent - Optional callback that sends a message to the work agent
 */
export async function dispatchTestAgentAndNotify(
  issueId: string,
  workspace?: string,
  branch?: string,
  notifyAgent?: (agentId: string, msg: string) => Promise<void>,
): Promise<void> {
  let testTaskDelivered = false;

  try {
    const resolved = resolveProjectFromIssue(issueId);
    if (!resolved) {
      console.error(`[test-dispatch] No project configured for ${issueId} — cannot spawn test role`);
      setReviewStatus(issueId, {
        testStatus: 'dispatch_failed',
        testNotes: `No project configured for ${issueId}. Add it to projects.yaml.`,
      });
      return;
    }

    const prompt = buildTestRolePrompt({ issueId, workspace, branch });
    const run = await spawnRun(issueId, 'test', {
      workspace,
      prompt,
    });

    setReviewStatus(issueId, { testStatus: 'testing' });
    testTaskDelivered = true;
    console.log(`[test-dispatch] Started test role for ${issueId} (${run.id})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already running')) {
      setReviewStatus(issueId, { testStatus: 'testing' });
      testTaskDelivered = true;
      console.log(`[test-dispatch] Test role already running for ${issueId}`);
    } else {
      console.error(`[test-dispatch] Failed to dispatch test role for ${issueId}:`, err);
      try {
        setReviewStatus(issueId, {
          testStatus: 'dispatch_failed',
          testNotes: `Dispatch failed: ${msg}`,
        });
      } catch (statusErr) {
        console.error(`[test-dispatch] Failed to set dispatch_failed status for ${issueId}:`, statusErr);
      }
    }
  }

  // Only notify work agent when test was successfully dispatched
  if (testTaskDelivered && notifyAgent) {
    try {
      await notifyAgent(
        `agent-${issueId.toLowerCase()}`,
        `REVIEW PASSED for ${issueId}. The test role has been dispatched automatically. Do NOT poll or check status — you will be notified when tests complete.`,
      );
    } catch (err) {
      console.log(
        `[test-dispatch] Could not notify work agent for ${issueId} (may not be running): ${(err as Error).message}`,
      );
    }
  }
}

// ─── Effect variant (PAN-1249) ───────────────────────────────────────────────

/** A test-role dispatch error — wraps spawnRun / setReviewStatus failures. */
export class TestDispatchError extends Data.TaggedError('TestDispatchError')<{
  readonly issueId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface DispatchTestAgentResult {
  readonly delivered: boolean;
  readonly notified: boolean;
  readonly runId?: string;
  readonly reason?: 'no-project' | 'already-running' | 'spawn-failed';
}

/**
 * Effect variant of {@link dispatchTestAgentAndNotify}. Same semantics as the
 * Promise version, but failures funnel through a typed error channel. The
 * `notifyAgent` step is allowed to fail without failing the outer Effect — its
 * outcome is reported via {@link DispatchTestAgentResult.notified}.
 */
export const dispatchTestAgentAndNotifyEffect = (
  issueId: string,
  workspace?: string,
  branch?: string,
  notifyAgent?: (agentId: string, msg: string) => Promise<void>,
): Effect.Effect<DispatchTestAgentResult> =>
  Effect.gen(function* () {
    const resolved = yield* Effect.sync(() => resolveProjectFromIssue(issueId));
    if (!resolved) {
      yield* Effect.sync(() => {
        console.error(`[test-dispatch] No project configured for ${issueId} — cannot spawn test role`);
        setReviewStatus(issueId, {
          testStatus: 'dispatch_failed',
          testNotes: `No project configured for ${issueId}. Add it to projects.yaml.`,
        });
      });
      return { delivered: false, notified: false, reason: 'no-project' as const };
    }

    const prompt = buildTestRolePrompt({ issueId, workspace, branch });

    const spawnEffect: Effect.Effect<DispatchTestAgentResult, never> = Effect.tryPromise({
      try: () => spawnRun(issueId, 'test', { workspace, prompt }),
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
              setReviewStatus(issueId, { testStatus: 'testing' });
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
            try {
              setReviewStatus(issueId, {
                testStatus: 'dispatch_failed',
                testNotes: `Dispatch failed: ${err.message}`,
              });
            } catch (statusErr) {
              console.error(`[test-dispatch] Failed to set dispatch_failed status for ${issueId}:`, statusErr);
            }
            return {
              delivered: false,
              notified: false,
              reason: 'spawn-failed',
            };
          });
        },
        onSuccess: (run) =>
          Effect.sync((): DispatchTestAgentResult => {
            setReviewStatus(issueId, { testStatus: 'testing' });
            console.log(`[test-dispatch] Started test role for ${issueId} (${run.id})`);
            return {
              delivered: true,
              notified: false,
              runId: run.id,
            };
          }),
      }),
    );

    const spawnResult: DispatchTestAgentResult = yield* spawnEffect;

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
