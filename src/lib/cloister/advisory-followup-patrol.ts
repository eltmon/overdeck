/**
 * PAN-5218: the deacon-lite patrol that files advisory follow-ups the
 * post-merge kick missed.
 *
 * The kick (`merge-agent.ts`) runs once, in memory, right after
 * `merge.completed`. It misses a delivery when the process restarts mid-run,
 * or when the CodeRabbit relay journals its delivery after the merge (the relay
 * is not awaited and reads threads before journaling). The journal is the job
 * record: a candidate with no `feedback.followup_filed` or
 * `feedback.followup_failed` is still pending, so this patrol re-runs the filer
 * for it.
 *
 * It waits until `merge.completed` is at least 10 minutes old and the candidate
 * at least 2 minutes old. The kick runs in the dashboard process and the patrol
 * in the deacon child, so the in-process join cannot stop them racing; the ages
 * leave the kick's normal run time to finish first. Runs after the merge, never
 * on a merge path. Never throws.
 */
import { existsSync } from 'node:fs';

import type { WorkspaceRow } from '../workspaces/resolver.js';
import { advisoryCandidates, advisoryDeliveryData, isAdvisoryCandidateClosed } from './advisory-followup-settlement.js';
import { fileAdvisoryFollowups, isAdvisoryKeyResolvedInProcess, type AdvisoryFollowupOutcome } from './advisory-followup.js';
import { readPipelineJournal, type PipelineJournalEntry } from './pipeline-journal.js';

export const ADVISORY_PATROL_MERGE_AGE_MS = 10 * 60_000;
export const ADVISORY_PATROL_CANDIDATE_AGE_MS = 2 * 60_000;

export interface AdvisoryPatrolDeps {
  listWorkspaces?: () => Pick<WorkspaceRow, 'issueId' | 'path'>[];
  readJournal?: (workspacePath: string) => PipelineJournalEntry[];
  file?: (issueId: string, workspacePath: string) => Promise<AdvisoryFollowupOutcome[]>;
  log?: (line: string) => void;
}

/** Pending advisory candidates: not closed, carrying threads, not already decided in this process. */
export function pendingAdvisoryCandidates(entries: readonly PipelineJournalEntry[]): PipelineJournalEntry[] {
  return advisoryCandidates(entries).filter((candidate) => {
    const dedupKey = String(candidate.data?.dedupKey);
    return !isAdvisoryCandidateClosed(entries, dedupKey)
      && advisoryDeliveryData(candidate) !== null
      && !isAdvisoryKeyResolvedInProcess(dedupKey);
  });
}

function ageMs(at: string, now: number): number {
  const value = Date.parse(at);
  return Number.isFinite(value) ? now - value : -1;
}

async function defaultListWorkspaces(): Promise<Pick<WorkspaceRow, 'issueId' | 'path'>[]> {
  const { listWorkspaces } = await import('../workspaces/resolver.js');
  return listWorkspaces();
}

/** One pass. Never throws. Returns one `<ISSUE>: <n> follow-up outcome(s)` line per issue it ran the filer for. */
export async function recoverAdvisoryFollowups(now = Date.now(), deps: AdvisoryPatrolDeps = {}): Promise<string[]> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const actions: string[] = [];
  let workspaces: Pick<WorkspaceRow, 'issueId' | 'path'>[];
  try {
    workspaces = deps.listWorkspaces ? deps.listWorkspaces() : await defaultListWorkspaces();
  } catch (err) {
    log(`[advisory-followup] could not list workspaces: ${err instanceof Error ? err.message : String(err)}`);
    return actions;
  }
  const readJournal = deps.readJournal ?? readPipelineJournal;
  const file = deps.file ?? fileAdvisoryFollowups;

  for (const workspace of workspaces) {
    const issueId = workspace.issueId?.toUpperCase();
    if (!issueId || !workspace.path || !existsSync(workspace.path)) continue;
    try {
      const entries = readJournal(workspace.path);
      const merged = entries.some((entry) => entry.type === 'merge.completed' && ageMs(entry.at, now) >= ADVISORY_PATROL_MERGE_AGE_MS);
      if (!merged) continue;
      const due = pendingAdvisoryCandidates(entries).some((candidate) => ageMs(candidate.at, now) >= ADVISORY_PATROL_CANDIDATE_AGE_MS);
      if (!due) continue;
      const outcomes = await file(issueId, workspace.path);
      actions.push(`${issueId}: ${outcomes.length} follow-up outcome(s)`);
    } catch (err) {
      log(`[advisory-followup] patrol failed for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return actions;
}
