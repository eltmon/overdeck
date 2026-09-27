/**
 * Deferred review verdicts, replay half (PAN-4263).
 *
 * `pan admin specialists done review` journals `review.verdict-deferred` when
 * a transient forge failure (rate limit, network) stopped it recording the
 * verdict (`deferred-verdict.ts`). deacon-lite's `recoverStalledReviews` calls
 * this module while that entry is the journal's LAST entry, and it replays the
 * verdict through the same CLI door under the original caller, so every guard
 * (`reviewVerdictRefusal`) runs again. The replay grants nothing an agent
 * could not already do by exporting `OVERDECK_AGENT_ID` itself.
 *
 * The child's own journal entry ends the replay: `review.verdict` on success,
 * a fresh `review.verdict-deferred` on another transient failure (its age is
 * the next cooldown, so nothing is kept in memory across ticks). A replay
 * stops for good with `review.verdict-replay-gave-up` when the review moved on
 * to another run (`superseded`), after {@link DEFERRED_VERDICT_MAX_ATTEMPTS}
 * deferrals of one run (`cap`), or when the child failed without deferring
 * again (`failed`).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { emitActivityEntry } from '../activity-logger.js';
import { getAgentState, type AgentState } from '../agents/agent-state-read.js';
import { appendPipelineEntry, readPipelineJournal, type PipelineJournalEntry } from './pipeline-journal.js';

/** A deferred verdict waits this long after its entry before it is replayed. */
export const DEFERRED_VERDICT_MIN_AGE_MS = 10 * 60_000;
/** The original deferral plus six replays: about an hour, which spans GitHub's hourly GraphQL reset. */
export const DEFERRED_VERDICT_MAX_ATTEMPTS = 7;
const DEFERRED_VERDICT_REPLAY_TIMEOUT_MS = 5 * 60_000;

const VERDICT_STATUSES = ['passed', 'failed', 'blocked'] as const;

type ExecFileFn = (
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; encoding: 'utf-8' },
) => Promise<{ stdout: string; stderr: string }>;

export interface DeferredVerdictReplayDeps {
  execFile?: ExecFileFn;
  getAgentState?: (agentId: string) => AgentState | null;
}

/** Issues with a replay running; an overlapping tick does nothing for them. */
const replaysInFlight = new Set<string>();

/** The environment the replay runs under: the original caller, or an operator shell. */
export function deferredVerdictReplayEnv(callerId: string | null, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  if (callerId) {
    env.OVERDECK_AGENT_ID = callerId;
  } else {
    delete env.OVERDECK_AGENT_ID;
    delete env.OVERDECK_ISSUE_ID;
    delete env.OVERDECK_SESSION_TYPE;
  }
  return env;
}

function giveUp(workspacePath: string, issueId: string, runId: string | null, reason: 'superseded' | 'cap' | 'failed'): void {
  appendPipelineEntry(workspacePath, {
    type: 'review.verdict-replay-gave-up',
    issueId,
    source: 'deacon-lite',
    data: { runId, reason },
  });
}

function countDeferrals(workspacePath: string, runId: string | null): number {
  return readPipelineJournal(workspacePath).filter((journalEntry) =>
    journalEntry.type === 'review.verdict-deferred' && (journalEntry.data?.runId ?? null) === runId,
  ).length;
}

/**
 * Replay the deferred review verdict `entry` (the journal's last entry) when
 * it is old enough. Returns a patrol action line when a replay recorded the
 * verdict, otherwise `null`.
 */
export async function replayDeferredReviewVerdict(
  issueId: string,
  workspacePath: string,
  entry: PipelineJournalEntry,
  now: number,
  deps: DeferredVerdictReplayDeps = {},
): Promise<string | null> {
  const at = Date.parse(entry.at);
  if (Number.isNaN(at) || now - at < DEFERRED_VERDICT_MIN_AGE_MS) return null;
  if (replaysInFlight.has(issueId)) return null;

  const data = entry.data ?? {};
  const runId = typeof data.runId === 'string' && data.runId ? data.runId : null;
  const status = VERDICT_STATUSES.find((candidate) => candidate === data.status);
  if (!status) {
    console.warn(`[deacon-lite] ${issueId}: deferred verdict entry has no valid status — not replaying it`);
    giveUp(workspacePath, issueId, runId, 'failed');
    return null;
  }

  // A verdict belongs to the run that produced it; a newer run supersedes it.
  if (runId) {
    let currentRunId: string | undefined;
    try {
      currentRunId = (deps.getAgentState ?? getAgentState)(`agent-${issueId.toLowerCase()}-review`)?.reviewRunId;
    } catch (err) {
      // An unreadable state file is no answer; wait for a readable one.
      console.warn(`[deacon-lite] ${issueId}: review state unreadable — deferred verdict replay waits: ${String(err)}`);
      return null;
    }
    if (currentRunId !== runId) {
      giveUp(workspacePath, issueId, runId, 'superseded');
      return null;
    }
  }

  const attempts = countDeferrals(workspacePath, runId);
  if (attempts >= DEFERRED_VERDICT_MAX_ATTEMPTS) {
    giveUp(workspacePath, issueId, runId, 'cap');
    emitActivityEntry({
      source: 'review',
      level: 'warn',
      issueId,
      message: `${issueId}: a ${status} review verdict could not be recorded after ${attempts} attempts — the review needs the operator`,
    });
    return null;
  }

  const notes = typeof data.notes === 'string' && data.notes ? data.notes : null;
  const callerId = typeof data.callerId === 'string' && data.callerId ? data.callerId : null;
  const args = [
    'admin', 'specialists', 'done', 'review', issueId,
    '--status', status,
    ...(runId ? ['--run-id', runId] : []),
    ...(notes ? ['--notes', notes] : []),
  ];
  const run = deps.execFile ?? (promisify(execFile) as unknown as ExecFileFn);

  replaysInFlight.add(issueId);
  const journalLength = readPipelineJournal(workspacePath).length;
  let failure: unknown = null;
  try {
    await run('pan', args, {
      env: deferredVerdictReplayEnv(callerId),
      timeout: DEFERRED_VERDICT_REPLAY_TIMEOUT_MS,
      encoding: 'utf-8',
    });
  } catch (err) {
    failure = err;
  } finally {
    replaysInFlight.delete(issueId);
  }

  // The child's own journal entries say what happened, whatever its exit code:
  // a recorded verdict ends the replay; a fresh deferral (another transient
  // failure) is the next cooldown.
  const appended = readPipelineJournal(workspacePath).slice(journalLength);
  if (appended.some((journalEntry) => journalEntry.type === 'review.verdict')) {
    return `recoverStalledReviews: recorded the deferred ${status} review verdict for ${issueId}`;
  }
  if (appended.some((journalEntry) => journalEntry.type === 'review.verdict-deferred')) return null;

  const stderr = String((failure as { stderr?: unknown } | null)?.stderr ?? '').trim();
  const detail = failure
    ? (stderr || (failure instanceof Error ? failure.message : String(failure))).slice(-500)
    : 'the replay exited without recording or deferring the verdict';
  console.warn(`[deacon-lite] ${issueId}: deferred verdict replay failed: ${detail}`);
  giveUp(workspacePath, issueId, runId, 'failed');
  return null;
}
