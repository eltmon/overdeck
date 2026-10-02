/**
 * PAN-4384: the conflict-repair patrol's tick. An approved PR that
 * turns CONFLICTING with main is refused by the merge gate before any merge
 * door can rebase it, and nothing else routes it back. Each tick finds such a
 * PR from the live forge facts (`evaluateConflictRepairGate`), sends the
 * issue's work agent one sync-main repair per PR head, and raises Needs-you
 * once when the same head still conflicts after `CONFLICT_REPAIR_GRACE_MS`, or
 * at once when the agent cannot be reached. When a repair moved the head and
 * the agent never asked for review, it asks the guarded review door once.
 *
 * Nothing is stored. Each repair and escalation is an action journaled in the
 * workspace's pipeline journal with the head it was for (`data.head`), and
 * the next tick counts those entries, so a dashboard restart never re-sends a
 * repair. The host (the dashboard's `conflict-repair-patrol.ts`) owns the
 * timer and the global skips; every I/O here is injectable.
 */
import { existsSync } from 'node:fs';

import { getIssuePause, type IssuePause } from '../agents/agent-state.js';
import { messageAgent, type MessageDeliveryOutcome } from '../agents/messaging.js';
import { listWorkspaces } from '../workspaces/resolver.js';
import type { WorkspaceRow } from '../workspaces/types.js';
import { probeBranchConflictPaths } from './conflict-gate.js';
import {
  resolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou,
  type IssueFeedbackTarget,
} from './feedback-target.js';
import { evaluateConflictRepairGate, type ConflictRepairGateResult } from './merge-gate.js';
import {
  appendPipelineEntry,
  readPipelineJournal,
  type PipelineJournalEntry,
} from './pipeline-journal.js';
import { getGuardedReviewRequester, type GuardedReviewRequestOutcome } from './request-review-pipeline.js';

export const CONFLICT_REPAIR_INTERVAL_MS = 60_000;
/** How long one repair may take before a head that still conflicts escalates. */
export const CONFLICT_REPAIR_GRACE_MS = 45 * 60_000;
/** How long after a repair the patrol waits for the agent's own review request. */
export const CONFLICT_REPAIR_REVIEW_BACKSTOP_MS = 15 * 60_000;

const SOURCE = 'conflict-repair';

export interface ConflictRepairDeps {
  listWorkspaces?: () => Pick<WorkspaceRow, 'issueId' | 'path'>[];
  readJournal?: (workspacePath: string) => PipelineJournalEntry[];
  appendEntry?: (workspacePath: string, entry: Omit<PipelineJournalEntry, 'at'>) => unknown;
  getIssuePause?: (issueId: string) => IssuePause;
  evaluateGate?: (issueId: string) => Promise<ConflictRepairGateResult>;
  resolveTarget?: (issueId: string) => Promise<IssueFeedbackTarget>;
  deliver?: (agentId: string, prompt: string, dedupKey: string) => Promise<MessageDeliveryOutcome>;
  surfaceNeedsYou?: (issueId: string, reason: string, details: Record<string, unknown>) => Promise<void>;
  /** The conflicting paths, for the prompt text only. */
  probeConflictPaths?: (workspacePath: string) => Promise<string[]>;
  /** The guarded review request, for the post-repair backstop. */
  requestReview?: (issueId: string) => Promise<GuardedReviewRequestOutcome | null>;
  now?: () => number;
  log?: (message: string) => void;
}

/** Issues whose repair dispatch is still running, so an overlapping tick skips them. */
const inFlight = new Set<string>();
/** When the backstop last asked for review, per issue, so a refusing door is not asked every tick. */
const lastBackstopAt = new Map<string, number>();
/** `<issue>:<head>` pairs whose backstop refusal already raised Needs-you. */
const refusalsSurfaced = new Set<string>();
/** Guarded-door answers that need the operator: the review will not start on its own. */
const OPERATOR_REFUSALS = new Set<GuardedReviewRequestOutcome['kind']>(['circuit-breaker', 'no-project', 'dirty-workspace']);

export function __resetConflictRepairStateForTests(): void {
  inFlight.clear();
  lastBackstopAt.clear();
  refusalsSurfaced.clear();
}

/**
 * The journal pre-filter (NFR-1): the last review verdict approved the PR and
 * no merge completed after it. Only these issues cost a forge read.
 */
export function isConflictRepairCandidate(entries: readonly PipelineJournalEntry[]): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === 'merge.completed') return false;
    if (entry.type === 'review.verdict') return entry.data?.verdict === 'APPROVED';
  }
  return false;
}

export function buildConflictRepairPrompt(input: {
  issueId: string;
  head: string;
  conflictPaths: readonly string[];
}): string {
  const { issueId, head } = input;
  const paths = input.conflictPaths.length > 0 ? input.conflictPaths.join(', ') : 'run git merge-tree to list them';
  return [
    `CONFLICT REPAIR: the PR for ${issueId} (head ${head}) is approved but now conflicts with origin/main, so it cannot merge.`,
    'GitHub runs no CI on a conflicting PR; CI runs again on the head you push.',
    `Conflicting paths: ${paths}`,
    '',
    '0. Commit or discard any uncommitted work first (never git stash); pan sync-main needs a clean tree.',
    `1. Run \`pan sync-main ${issueId}\` to merge origin/main into this branch (it does not push).`,
    `2. Read what main changed and what ${issueId} intended; resolve every conflict so both intents survive.`,
    '3. Generated files: do not hand-merge conflict markers.',
    "   - scripts/file-size-allowlist.txt: take main's rows and keep only rows this branch already had on main or legitimately added; never raise a cap (the pre-push guard refuses agent raises). If a file is over its cap, shrink the file.",
    "   - .overdeck/context/codebase/*.md: keep both sides' statements and refresh the `<!-- last-verified: -->` date.",
    "   - bun.lock: take main's version, then run `bun install`.",
    '   - Slash-command manifest: run `npm run generate:slash-commands`.',
    '   - .pan/continues and .pan/specs: pan sync-main already prefers main.',
    '4. Run `npm run typecheck`, `npm run lint`, and `npx vitest run` on the test files the conflict touched.',
    `5. Commit, push the branch, then run \`pan review request ${issueId}\`. The merged head needs a fresh approval before it can merge.`,
    "If the conflict cannot be resolved without changing either feature's intent, stop and say so; the pipeline escalates to the operator.",
  ].join('\n');
}

/**
 * Decision 2: keyed delivery through the resurrection ladder's target; a
 * transport that cannot enforce the key gets one unkeyed retry (the
 * `review-verdict-feedback.ts` precedent).
 */
async function defaultDeliver(agentId: string, prompt: string, dedupKey: string): Promise<MessageDeliveryOutcome> {
  try {
    return await messageAgent(agentId, prompt, SOURCE, { owesRework: true, feedbackRedelivery: true, dedupKey });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (!reason.includes('cannot enforce a dedup key')) throw err;
    return messageAgent(agentId, prompt, SOURCE, { owesRework: true, feedbackRedelivery: true });
  }
}

async function defaultRequestReview(issueId: string): Promise<GuardedReviewRequestOutcome | null> {
  const requester = getGuardedReviewRequester();
  if (!requester) {
    console.log(`[conflict-repair] ${issueId}: no guarded review requester in this process; backstop skipped`);
    return null;
  }
  return requester(issueId, { source: SOURCE, message: 'conflict repair pushed a new head; re-review it' });
}

async function defaultProbeConflictPaths(workspacePath: string): Promise<string[]> {
  return (await probeBranchConflictPaths(workspacePath, 'main')).paths;
}

interface Resolved {
  listWorkspaces: NonNullable<ConflictRepairDeps['listWorkspaces']>;
  readJournal: NonNullable<ConflictRepairDeps['readJournal']>;
  appendEntry: NonNullable<ConflictRepairDeps['appendEntry']>;
  getIssuePause: NonNullable<ConflictRepairDeps['getIssuePause']>;
  evaluateGate: NonNullable<ConflictRepairDeps['evaluateGate']>;
  resolveTarget: NonNullable<ConflictRepairDeps['resolveTarget']>;
  deliver: NonNullable<ConflictRepairDeps['deliver']>;
  surfaceNeedsYou: NonNullable<ConflictRepairDeps['surfaceNeedsYou']>;
  probeConflictPaths: NonNullable<ConflictRepairDeps['probeConflictPaths']>;
  requestReview: NonNullable<ConflictRepairDeps['requestReview']>;
  now: () => number;
  log: (message: string) => void;
}

function resolveDeps(deps: ConflictRepairDeps): Resolved {
  return {
    listWorkspaces: deps.listWorkspaces ?? (() => listWorkspaces()),
    readJournal: deps.readJournal ?? ((path) => readPipelineJournal(path)),
    appendEntry: deps.appendEntry ?? appendPipelineEntry,
    getIssuePause: deps.getIssuePause ?? getIssuePause,
    evaluateGate: deps.evaluateGate ?? ((issueId) => evaluateConflictRepairGate(issueId)),
    resolveTarget: deps.resolveTarget ?? ((issueId) => resolveIssueFeedbackTarget(issueId)),
    deliver: deps.deliver ?? defaultDeliver,
    surfaceNeedsYou: deps.surfaceNeedsYou ?? surfaceIssueFeedbackNeedsYou,
    probeConflictPaths: deps.probeConflictPaths ?? defaultProbeConflictPaths,
    requestReview: deps.requestReview ?? defaultRequestReview,
    now: deps.now ?? Date.now,
    log: deps.log ?? ((message) => console.log(message)),
  };
}

function entriesForHead(entries: readonly PipelineJournalEntry[], head: string) {
  const forHead = (type: PipelineJournalEntry['type']) =>
    entries.filter((entry) => entry.type === type && entry.data?.head === head);
  return { repairs: forHead('conflict.repair-requested'), escalations: forHead('conflict.repair-escalated') };
}

/**
 * Raise Needs-you, then journal the escalation whatever the announcement did:
 * the entry is what stops the next tick escalating the same head again.
 */
async function escalate(
  d: Resolved,
  workspacePath: string,
  issueId: string,
  gate: ConflictRepairGateResult,
  head: string,
  reason: string,
): Promise<void> {
  const pr = gate.facts.number ? `PR #${gate.facts.number}` : 'The PR';
  const message = reason === 'unreachable'
    ? `${pr} conflicts with main and its work agent could not be reached for a sync-main repair`
    : `${pr} still conflicts with main at ${head} after one sync-main repair attempt`;
  try {
    await d.surfaceNeedsYou(issueId, message, { head, prUrl: gate.facts.url, reason });
  } catch (err) {
    d.log(`[conflict-repair] Could not raise Needs-you for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  d.appendEntry(workspacePath, { type: 'conflict.repair-escalated', issueId, source: SOURCE, data: { head, reason } });
}

async function dispatchRepair(
  d: Resolved,
  workspacePath: string,
  issueId: string,
  gate: ConflictRepairGateResult,
  head: string,
): Promise<string> {
  const target = await d.resolveTarget(issueId);
  if ('needsYou' in target) {
    d.log(`[conflict-repair] ${issueId}: no work agent to repair ${head}: ${target.reason}`);
    await escalate(d, workspacePath, issueId, gate, head, 'unreachable');
    return 'escalated';
  }
  let conflictPaths: string[] = [];
  try {
    conflictPaths = await d.probeConflictPaths(workspacePath);
  } catch {
    // The paths only make the prompt more specific; the agent can list them.
  }
  const prompt = buildConflictRepairPrompt({ issueId, head, conflictPaths });
  const dedupKey = `conflict-repair:${issueId.toLowerCase()}:${head}`;
  let failure: string | null = null;
  try {
    const outcome = await d.deliver(target.agentId, prompt, dedupKey);
    if (!outcome.delivered && !outcome.queuedToMail) failure = outcome.reason ?? 'delivery was not accepted';
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }
  if (failure !== null) {
    d.log(`[conflict-repair] ${issueId}: repair delivery to ${target.agentId} failed: ${failure}`);
    await escalate(d, workspacePath, issueId, gate, head, 'unreachable');
    return 'escalated';
  }
  d.appendEntry(workspacePath, {
    type: 'conflict.repair-requested',
    issueId,
    source: SOURCE,
    data: { head, agentId: target.agentId, conflictPaths },
  });
  d.log(`[conflict-repair] ${issueId}: sent a sync-main repair for ${head} to ${target.agentId}`);
  return 'repair-requested';
}

/**
 * FR-7: the agent pushed a repair but never asked for review, so the moved
 * head sits approved-by-nobody. Once the repair is old enough, ask the guarded
 * door once; the door journals `review.requested`, which ends the backstop.
 */
async function reviewBackstop(
  d: Resolved,
  issueId: string,
  entries: readonly PipelineJournalEntry[],
  gate: ConflictRepairGateResult,
): Promise<string | null> {
  const { facts } = gate;
  if (!facts.open || facts.mergeable !== true || !facts.headSha) return null;
  let repairIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].type === 'conflict.repair-requested') {
      repairIndex = index;
      break;
    }
  }
  if (repairIndex < 0) return null;
  const repair = entries[repairIndex];
  const head = facts.headSha.slice(0, 8);
  if (repair.data?.head === head) return null;
  if (entries.slice(repairIndex + 1).some((entry) => entry.type === 'review.requested')) return null;
  const now = d.now();
  if (now - Date.parse(repair.at) < CONFLICT_REPAIR_REVIEW_BACKSTOP_MS) return null;
  const { repairs, escalations } = entriesForHead(entries, head);
  if (repairs.length > 0 || escalations.length > 0) return null;
  const last = lastBackstopAt.get(issueId);
  if (last !== undefined && now - last < CONFLICT_REPAIR_REVIEW_BACKSTOP_MS) return null;
  lastBackstopAt.set(issueId, now);
  d.log(`[conflict-repair] ${issueId}: repaired head ${head} has no review request; requesting review`);
  const outcome = await d.requestReview(issueId);
  const kind = outcome?.kind ?? 'no-requester';
  d.log(`[conflict-repair] ${issueId}: backstop review request for ${head} answered ${kind}`);
  const refusalKey = `${issueId}:${head}`;
  if (outcome && OPERATOR_REFUSALS.has(outcome.kind) && !refusalsSurfaced.has(refusalKey)) {
    refusalsSurfaced.add(refusalKey);
    try {
      await d.surfaceNeedsYou(
        issueId,
        `${facts.number ? `PR #${facts.number}` : 'The PR'} was repaired to ${head} but its review request was refused (${kind})`,
        { head, prUrl: facts.url, reason: kind },
      );
    } catch (err) {
      d.log(`[conflict-repair] Could not raise Needs-you for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return `review-requested (${kind})`;
}

async function tickIssue(d: Resolved, issueId: string, workspacePath: string): Promise<string | null> {
  const entries = d.readJournal(workspacePath);
  if (!isConflictRepairCandidate(entries)) return null;
  if (d.getIssuePause(issueId).status !== 'unpaused') return null;

  const gate = await d.evaluateGate(issueId);
  if (!gate.conflicting) return reviewBackstop(d, issueId, entries, gate);
  if (!gate.facts.headSha) return null;

  const head = gate.facts.headSha.slice(0, 8);
  const { repairs, escalations } = entriesForHead(entries, head);
  if (escalations.length > 0) return null;
  if (repairs.length === 0) return dispatchRepair(d, workspacePath, issueId, gate, head);

  const repairedAt = Date.parse(repairs[repairs.length - 1].at);
  if (d.now() - repairedAt >= CONFLICT_REPAIR_GRACE_MS) {
    await escalate(d, workspacePath, issueId, gate, head, 'conflict survived one repair attempt');
    return 'escalated';
  }
  return null;
}

/**
 * One patrol pass over every feature workspace. Never throws; one issue's
 * failure is logged and the rest still run (NFR-2). Returns one
 * `<ISSUE>: <action>` line per issue it acted on.
 */
export async function tickConflictRepair(deps: ConflictRepairDeps = {}): Promise<string[]> {
  const d = resolveDeps(deps);
  const actions: string[] = [];
  let workspaces: Pick<WorkspaceRow, 'issueId' | 'path'>[];
  try {
    workspaces = d.listWorkspaces();
  } catch (err) {
    d.log(`[conflict-repair] Could not list workspaces: ${err instanceof Error ? err.message : String(err)}`);
    return actions;
  }
  const seen = new Set<string>();
  for (const workspace of workspaces) {
    if (!workspace.issueId || !existsSync(workspace.path)) continue;
    const issueId = workspace.issueId.toUpperCase();
    if (seen.has(issueId) || inFlight.has(issueId)) continue;
    seen.add(issueId);
    inFlight.add(issueId);
    try {
      const action = await tickIssue(d, issueId, workspace.path);
      if (action) actions.push(`${issueId}: ${action}`);
    } catch (err) {
      d.log(`[conflict-repair] ${issueId}: tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      inFlight.delete(issueId);
    }
  }
  return actions;
}
