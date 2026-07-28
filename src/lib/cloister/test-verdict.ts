/**
 * Deterministic test-verdict artifact contract (PAN-1681).
 *
 * The test role narrates "tests pass" but the agent (often Haiku 4.5) sometimes
 * never POSTs the verdict, stranding the issue at test=pending. To make the
 * verdict recoverable the test role writes a small work-product artifact at
 * `.pan/test/result.json` BEFORE it POSTs testStatus — symmetric with how the
 * review convoy reviewers write report files / the synthesis agent writes
 * `synthesis.md`, which `checkCompletedButUnsignaledReviews` already reads.
 *
 * The deacon failsafe `checkCompletedButUnsignaledTests` reads this artifact to
 * recover the verdict for an idle/dead test agent. It NEVER guesses pass/fail —
 * it only acts on a written artifact (continue.json decision D6). With no
 * artifact the most it does is nudge once to prompt the agent to write+POST;
 * after that the strand-surfacing path makes the stuck state visible.
 *
 * This module is intentionally dependency-free (only node:fs/path) so it can be
 * imported by both the dispatcher (test-agent-queue.ts) and the deacon patrol
 * (deacon.ts) and unit-tested without pulling in the heavy deacon module.
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { XBriefDocument } from '../xbrief/types.js';

export interface TestVerdictArtifact {
  status: 'passed' | 'failed';
  notes?: string;
}

/** Workspace-relative path to the test verdict artifact. */
export function testVerdictArtifactPath(workspacePath: string): string {
  return join(workspacePath, '.pan', 'test', 'result.json');
}

/**
 * Delete any stale verdict artifact. Called at every test-dispatch site so a
 * previous cycle's verdict can never be misread as the current one (hazard H3).
 * Best-effort — a missing file is the desired post-condition anyway.
 */
export function clearTestVerdictArtifact(workspacePath: string): void {
  try {
    rmSync(testVerdictArtifactPath(workspacePath), { force: true });
  } catch {
    /* missing file is the desired state */
  }
}

/**
 * Read and validate the verdict artifact. Returns null when the file is absent,
 * malformed, carries an unknown status, or (when `minMtimeMs` is given) is older
 * than the current test dispatch — so a stale artifact from a previous cycle is
 * never honored even if clearing was missed (hazard H3).
 */
export function readTestVerdictArtifact(
  workspacePath: string,
  minMtimeMs?: number,
): TestVerdictArtifact | null {
  const p = testVerdictArtifactPath(workspacePath);
  if (!existsSync(p)) return null;
  if (minMtimeMs !== undefined) {
    try {
      if (statSync(p).mtimeMs < minMtimeMs) return null;
    } catch {
      return null;
    }
  }
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<TestVerdictArtifact>;
    if (parsed && (parsed.status === 'passed' || parsed.status === 'failed')) {
      return {
        status: parsed.status,
        notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export type UnsignaledTestDecision =
  | { action: 'wait' }
  | { action: 'none' }
  | { action: 'escalate' }
  | { action: 'auto-complete'; status: 'passed' | 'failed'; notes?: string }
  | { action: 'nudge-verdict'; status: 'passed' | 'failed'; notes?: string }
  | { action: 'nudge-write' };

/**
 * Pure decision core for `checkCompletedButUnsignaledTests`. Given the test
 * session's liveness/idleness, whether we already nudged this cycle, and the
 * recovered verdict artifact (or null), decide what the deacon should do.
 *
 * Safety rule (D6): NEVER fabricate a verdict. `auto-complete` happens only from
 * a written artifact; with no artifact the most we do is nudge once to prompt
 * the agent to write+POST, then defer to the strand-surfacing path. A false
 * "passed" would ship unverified code; a surfaced stuck state is the safe
 * failure mode.
 */
export function decideUnsignaledTestAction(input: {
  /** session exists AND its pane is not dead */
  sessionLive: boolean;
  /** idle past the settle window (only meaningful when sessionLive) */
  idle: boolean;
  /** already nudged within the dedup window this cycle */
  alreadyNudged: boolean;
  artifact: TestVerdictArtifact | null;
}): UnsignaledTestDecision {
  const { sessionLive, idle, alreadyNudged, artifact } = input;

  // Dead session: recover only from a written verdict. With no artifact there is
  // nothing to recover here — checkPendingTestDispatch / the orphan sweep own
  // re-dispatch, and the strand-surfacing path owns visibility.
  if (!sessionLive) {
    if (artifact) return { action: 'auto-complete', status: artifact.status, notes: artifact.notes };
    return { action: 'none' };
  }

  // Alive but still working — leave it alone until it goes idle past the settle
  // window. (A genuinely running agent emits activity and is never "idle" here.)
  if (!idle) return { action: 'wait' };

  // Alive + idle.
  if (artifact) {
    // Already nudged once and still no signal → the agent is unresponsive;
    // complete from the artifact so the pipeline isn't blocked.
    if (alreadyNudged) return { action: 'auto-complete', status: artifact.status, notes: artifact.notes };
    return { action: 'nudge-verdict', status: artifact.status, notes: artifact.notes };
  }

  // No artifact: never guess. Nudge once to write+POST; if the agent is still
  // unresponsive after that, escalate to the operator. PAN-3092 (MIN-858): the
  // old `none` here was terminal — a live agent holding a finished verdict in
  // its pane and nothing else sat there for six hours while every surface
  // reported it healthy. No automatic path can recover a pane-only verdict, so
  // the honest move is to tell a human, not to keep quiet.
  if (alreadyNudged) return { action: 'escalate' };
  return { action: 'nudge-write' };
}

/**
 * PAN-3092: surface an `escalate` decision to the operator, once per test
 * dispatch generation. Returns the needs-you line to log, or undefined when this
 * generation already tripped. Never touches the verdict itself (D6) — a
 * pane-only verdict is a human's call to read and apply.
 */
export async function recordUnsignaledTestEscalation(
  workspacePath: string,
  issueId: string,
  testSession: string,
  generation: string,
): Promise<string | undefined> {
  const { recordRecoveryFailure } = await import('./recovery-trip.js');
  const { emitNeedsYou } = await recordRecoveryFailure(
    workspacePath, issueId, 'unsignaled-test-verdict', generation, 1,
  );
  if (!emitNeedsYou) return undefined;
  return (
    `needs-you ${issueId}: the test agent (${testSession}) is alive but has not responded to a verdict ` +
    `nudge, and it wrote no .pan/test/result.json — its verdict may exist only in the agent's pane, where ` +
    `nothing can recover it automatically. Read the pane ` +
    `(tmux -L overdeck capture-pane -t ${testSession} -p -S -200), then either apply the verdict yourself ` +
    `(pan admin specialists done test ${issueId} --status passed|failed) or run pan kill ${issueId} and ` +
    `re-dispatch the test.`
  );
}

export function resolveSlotFeedbackAgentId(
  issueId: string,
  slotItemId: string | undefined,
  _doc: XBriefDocument | null | undefined,
  slotOwnership: Array<{ slotIndex: number; slotItemId?: string; itemId?: string }> = [],
): string | null {
  const normalizedItemId = slotItemId?.trim();
  if (!normalizedItemId) return null;

  const persistedOwner = slotOwnership.find(slot => (slot.slotItemId ?? slot.itemId) === normalizedItemId);
  if (persistedOwner) return `agent-${issueId.toLowerCase()}-slot-${persistedOwner.slotIndex}`;

  return null;
}
