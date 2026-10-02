/**
 * PAN-4451: the blocker-wake patrol's tick. An agent that parks an item with
 * `pan task block <issue> <item> --on <refs...>` journals `blocked.declared`
 * naming the issues and PRs it waits on. Each tick finds the declarations that
 * are still live and whose every blocker has merged, and sends the issue's
 * work agent one message per issue listing every resolved item.
 *
 * Nothing is stored. A declaration is live while its item is still `blocked`
 * in the continue file and no `blocked.woken` entry names its `at`, so
 * `pan task unblock`, `reopen`, `cancel` and `done` end it with no extra
 * write, and a dashboard restart never re-sends a wake. The host (the
 * dashboard's `blocker-wake-patrol.ts`) owns the timer and the global skips;
 * every I/O here is injectable.
 */
import { existsSync } from 'node:fs';

import { getIssuePause, type IssuePause } from '../agents/agent-state.js';
import { messageAgent, type MessageDeliveryOutcome } from '../agents/messaging.js';
import { runGh } from '../github-quota/run-gh.js';
import { resolvePlanHome } from '../pan-dir/paths.js';
import { listWorkspaces } from '../workspaces/resolver.js';
import type { WorkspaceRow } from '../workspaces/types.js';
import { readItemStatusesAsync } from '../xbrief/continue-state.js';
import { formatBlockerRef, parseStoredBlockerRef, type BlockerRef } from './blocker-refs.js';
import {
  resolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou,
  type IssueFeedbackTarget,
} from './feedback-target.js';
import {
  appendPipelineEntry,
  readPipelineJournal,
  type PipelineJournalEntry,
} from './pipeline-journal.js';
import { getPrFacts } from './pr-facts.js';

export const BLOCKER_WAKE_INTERVAL_MS = 120_000;

const SOURCE = 'blocker-wake';

export interface BlockerWakeDeps {
  listWorkspaces?: () => Pick<WorkspaceRow, 'issueId' | 'path'>[];
  readJournal?: (workspacePath: string) => PipelineJournalEntry[];
  appendEntry?: (workspacePath: string, entry: Omit<PipelineJournalEntry, 'at'>) => unknown;
  getIssuePause?: (issueId: string) => IssuePause;
  /** Item statuses from the continue file. */
  readItemStatuses?: (issueId: string, workspacePath: string) => Promise<Record<string, string>>;
  isMerged?: (ref: BlockerRef) => Promise<boolean>;
  resolveTarget?: (issueId: string) => Promise<IssueFeedbackTarget>;
  deliver?: (agentId: string, prompt: string, dedupKey: string) => Promise<MessageDeliveryOutcome>;
  surfaceNeedsYou?: (issueId: string, reason: string, details: Record<string, unknown>) => Promise<void>;
  log?: (message: string) => void;
}

/** Issues whose tick is still running, so an overlapping tick skips them. */
const inFlight = new Set<string>();
/** Canonical refs seen merged. Merged is permanent, so a ref is read until it merges, then never again. */
const mergedRefs = new Set<string>();

export function __resetBlockerWakeStateForTests(): void {
  inFlight.clear();
  mergedRefs.clear();
}

function declaredItem(entry: PipelineJournalEntry): string | null {
  return typeof entry.data?.item === 'string' ? entry.data.item : null;
}

/**
 * D6 without the continue file: per item, the newest `blocked.declared`,
 * kept only when no `blocked.woken` entry names its `at`.
 */
export function pendingDeclarations(entries: readonly PipelineJournalEntry[]): PipelineJournalEntry[] {
  const newest = new Map<string, PipelineJournalEntry>();
  const woken = new Set<string>();
  for (const entry of entries) {
    const item = declaredItem(entry);
    if (!item) continue;
    if (entry.type === 'blocked.declared') newest.set(item, entry);
    else if (entry.type === 'blocked.woken' && typeof entry.data?.declaredAt === 'string') {
      woken.add(`${item}\n${entry.data.declaredAt}`);
    }
  }
  return [...newest.entries()]
    .filter(([item, entry]) => !woken.has(`${item}\n${entry.at}`))
    .map(([, entry]) => entry);
}

export function buildBlockerWakePrompt(input: {
  issueId: string;
  items: readonly string[];
  blockers: readonly string[];
}): string {
  const { issueId, items, blockers } = input;
  return [
    `BLOCKERS MERGED: ${issueId} item(s) ${items.join(', ')} were blocked on ${blockers.join(', ')}; all of them have merged.`,
    '0. Commit or discard any uncommitted work first (never git stash).',
    `1. Run \`pan sync-main ${issueId}\` to bring the merged code into this branch.`,
    '2. Confirm the code you were waiting for is now present.',
    `3. Run \`pan task unblock ${issueId} <item>\` for each item above, then continue with \`pan task next ${issueId}\`.`,
    `If something you need is still missing, run \`pan task block ${issueId} <item> --on <ref>\` naming what you still wait on.`,
  ].join('\n');
}

/** D9: keyed delivery; a transport that cannot enforce the key gets one unkeyed retry. */
async function defaultDeliver(agentId: string, prompt: string, dedupKey: string): Promise<MessageDeliveryOutcome> {
  try {
    return await messageAgent(agentId, prompt, SOURCE, { owesRework: true, feedbackRedelivery: true, dedupKey });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (!reason.includes('cannot enforce a dedup key')) throw err;
    return messageAgent(agentId, prompt, SOURCE, { owesRework: true, feedbackRedelivery: true });
  }
}

/** D7: an issue merged when its feature branch's PR merged; a PR when GitHub says MERGED. */
async function defaultIsMerged(ref: BlockerRef): Promise<boolean> {
  if (ref.kind === 'issue') {
    const facts = await getPrFacts(ref.id, {}, { preferBranch: `feature/${ref.id.toLowerCase()}` });
    return facts.merged === true;
  }
  const { stdout } = await runGh(['pr', 'view', String(ref.number), '--repo', ref.repo, '--json', 'state']);
  return (JSON.parse(stdout) as { state?: string }).state === 'MERGED';
}

interface Resolved {
  listWorkspaces: NonNullable<BlockerWakeDeps['listWorkspaces']>;
  readJournal: NonNullable<BlockerWakeDeps['readJournal']>;
  appendEntry: NonNullable<BlockerWakeDeps['appendEntry']>;
  getIssuePause: NonNullable<BlockerWakeDeps['getIssuePause']>;
  readItemStatuses: NonNullable<BlockerWakeDeps['readItemStatuses']>;
  isMerged: NonNullable<BlockerWakeDeps['isMerged']>;
  resolveTarget: NonNullable<BlockerWakeDeps['resolveTarget']>;
  deliver: NonNullable<BlockerWakeDeps['deliver']>;
  surfaceNeedsYou: NonNullable<BlockerWakeDeps['surfaceNeedsYou']>;
  log: (message: string) => void;
}

function resolveDeps(deps: BlockerWakeDeps): Resolved {
  return {
    listWorkspaces: deps.listWorkspaces ?? (() => listWorkspaces()),
    readJournal: deps.readJournal ?? ((path) => readPipelineJournal(path)),
    appendEntry: deps.appendEntry ?? appendPipelineEntry,
    getIssuePause: deps.getIssuePause ?? getIssuePause,
    readItemStatuses: deps.readItemStatuses
      ?? ((issueId, path) => readItemStatusesAsync(resolvePlanHome(path), issueId)),
    isMerged: deps.isMerged ?? defaultIsMerged,
    resolveTarget: deps.resolveTarget ?? ((issueId) => resolveIssueFeedbackTarget(issueId)),
    deliver: deps.deliver ?? defaultDeliver,
    surfaceNeedsYou: deps.surfaceNeedsYou ?? surfaceIssueFeedbackNeedsYou,
    log: deps.log ?? ((message) => console.log(message)),
  };
}

/** True when every ref merged. Reads one ref at a time and stops at the first unmerged one. */
async function allMerged(d: Resolved, issueId: string, refs: readonly BlockerRef[]): Promise<boolean> {
  for (const ref of refs) {
    const key = formatBlockerRef(ref);
    if (mergedRefs.has(key)) continue;
    let merged = false;
    try {
      merged = await d.isMerged(ref);
    } catch (err) {
      d.log(`[blocker-wake] ${issueId}: could not read ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!merged) return false;
    mergedRefs.add(key);
  }
  return true;
}

interface ResolvedDeclaration {
  entry: PipelineJournalEntry;
  item: string;
  blockers: string[];
}

function journalWoken(
  d: Resolved,
  workspacePath: string,
  issueId: string,
  resolved: readonly ResolvedDeclaration[],
  outcome: 'delivered' | 'unreachable',
  agentId?: string,
): void {
  for (const { entry, item, blockers } of resolved) {
    d.appendEntry(workspacePath, {
      type: 'blocked.woken',
      issueId,
      source: SOURCE,
      data: { item, declaredAt: entry.at, blockers, outcome, ...(agentId ? { agentId } : {}) },
    });
  }
}

/**
 * Raise Needs-you, then journal the wake whatever the announcement did: the
 * entry is what stops the next tick retrying the same declaration.
 */
async function escalate(
  d: Resolved,
  workspacePath: string,
  issueId: string,
  resolved: readonly ResolvedDeclaration[],
  reason: string,
): Promise<string> {
  const items = resolved.map(({ item }) => item);
  const blockers = [...new Set(resolved.flatMap((declaration) => declaration.blockers))];
  try {
    await d.surfaceNeedsYou(
      issueId,
      `Blockers of ${items.join(', ')} merged but the work agent could not be reached`,
      { items, blockers, reason },
    );
  } catch (err) {
    d.log(`[blocker-wake] Could not raise Needs-you for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  journalWoken(d, workspacePath, issueId, resolved, 'unreachable');
  return 'escalated';
}

async function tickIssue(d: Resolved, issueId: string, workspacePath: string): Promise<string | null> {
  const pending = pendingDeclarations(d.readJournal(workspacePath));
  if (pending.length === 0) return null;
  if (d.getIssuePause(issueId).status !== 'unpaused') return null;

  const statuses = await d.readItemStatuses(issueId, workspacePath);
  const live = pending.filter((entry) => statuses[declaredItem(entry) ?? ''] === 'blocked');
  if (live.length === 0) return null;

  const resolved: ResolvedDeclaration[] = [];
  for (const entry of live) {
    const stored = Array.isArray(entry.data?.blockers) ? entry.data.blockers : [];
    const refs = stored
      .map((value) => (typeof value === 'string' ? parseStoredBlockerRef(value) : null))
      .filter((ref): ref is BlockerRef => ref !== null);
    if (refs.length === 0) continue;
    if (await allMerged(d, issueId, refs)) {
      resolved.push({ entry, item: declaredItem(entry)!, blockers: refs.map(formatBlockerRef) });
    }
  }
  if (resolved.length === 0) return null;

  const items = resolved.map(({ item }) => item);
  const target = await d.resolveTarget(issueId);
  if ('needsYou' in target) {
    d.log(`[blocker-wake] ${issueId}: no work agent to wake for ${items.join(', ')}: ${target.reason}`);
    return escalate(d, workspacePath, issueId, resolved, target.reason);
  }
  const blockers = [...new Set(resolved.flatMap((declaration) => declaration.blockers))];
  const prompt = buildBlockerWakePrompt({ issueId, items, blockers });
  const dedupKey = `blocker-wake:${issueId.toLowerCase()}:${resolved.map(({ entry }) => entry.at).join(',')}`;
  let failure: string | null = null;
  try {
    const outcome = await d.deliver(target.agentId, prompt, dedupKey);
    if (!outcome.delivered && !outcome.queuedToMail) failure = outcome.reason ?? 'delivery was not accepted';
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }
  if (failure !== null) {
    d.log(`[blocker-wake] ${issueId}: wake delivery to ${target.agentId} failed: ${failure}`);
    return escalate(d, workspacePath, issueId, resolved, failure);
  }
  journalWoken(d, workspacePath, issueId, resolved, 'delivered', target.agentId);
  d.log(`[blocker-wake] ${issueId}: woke ${target.agentId} for ${items.join(', ')}`);
  return `woke ${target.agentId} for ${items.join(', ')}`;
}

/**
 * One patrol pass over every feature workspace. Never throws; one issue's
 * failure is logged and the rest still run (NFR-2). Returns one
 * `<ISSUE>: <action>` line per issue it acted on.
 */
export async function tickBlockerWake(deps: BlockerWakeDeps = {}): Promise<string[]> {
  const d = resolveDeps(deps);
  const actions: string[] = [];
  let workspaces: Pick<WorkspaceRow, 'issueId' | 'path'>[];
  try {
    workspaces = d.listWorkspaces();
  } catch (err) {
    d.log(`[blocker-wake] Could not list workspaces: ${err instanceof Error ? err.message : String(err)}`);
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
      d.log(`[blocker-wake] ${issueId}: tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      inFlight.delete(issueId);
    }
  }
  return actions;
}
