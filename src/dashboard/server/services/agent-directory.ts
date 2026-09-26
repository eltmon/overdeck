/**
 * Agents Directory read model (PAN-3920 W3).
 *
 * D1 — The directory is derived on read. It stores nothing.
 * `GET /api/agent-directory` recomputes entries from `state.json` files, the
 * pane inventory, the conversation list, transcript files and
 * `remote-state.json`. Nothing it computes is written anywhere; no
 * `agent_directory.*` event exists. The frontend refetches.
 *
 * Sources, in build order:
 *   1. native agents   — `~/.overdeck/agents/<id>/state.json` (never `conv-*`)
 *   2. pane-only       — panes with Overdeck tokens and no state.json (`pan spawn`)
 *   3. conversations   — overdeck.db rows, enriched with liveness
 *   4. subagents       — Claude/Codex subagents of every non-stopped parent
 *   5. external        — `~/.overdeck/agents/ext-*` registrations (Phase C):
 *                        agents another tool launched (`pan worker register`,
 *                        the Codex-plugin adapter); state from the recorded
 *                        pid and the transcript (D21), see
 *                        agent-directory-external.ts
 *
 * Live scope (PAN-4197): `buildLiveAgentDirectory` keeps what is running or
 * waiting now instead of a time window — live entries, paused native agents of
 * an unfinished issue, and the newest work/strike agent of an issue waiting in
 * the pipeline (in review, changes requested, ready), read from the derived
 * issue states. Rules are FR-2 of `.pan/drafts/pan-4197.md`.
 *
 * Workers (Phase B, role `worker`) and external agents are entries with a
 * parent: their `parentId` names an agent id or a conversation tmux session,
 * which maps to that conversation's `conv:<name>` entry so they nest under it.
 * A `claude-session:<uuid>` parent (a Claude session Overdeck does not know)
 * stays as is.
 *
 * State vocabulary and window rules are D3/D4 of `.pan/drafts/pan-3920.md`;
 * docs/DASHBOARD-ARCHITECTURE.md "Agents Directory" restates them.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  AgentDirectoryResponse,
  BackendPane,
  DerivedIssueState,
  DirectoryEntry,
  DirectoryEntryState,
  DirectoryPause,
  HarnessName,
  IssueState,
} from '@overdeck/contracts';
import { getHarnessBehavior } from '@overdeck/contracts';

import { isOperatorPause, listAgentStatesAsync, type AgentState } from '../../../lib/agents/agent-state-read.js';
import { latestWorkerReportAt as defaultLatestWorkerReportAt } from '../../../lib/agents/worker/report.js';
import { readWorkerFacts } from '../../../lib/agents/worker/facts.js';
import { workerNumber } from '../../../lib/agents/worker/ids.js';
import { createSettledTtlPromiseCache, withConcurrencyLimit } from '../../../lib/concurrency.js';
import { getEnrichedConversationList } from '../../../lib/overdeck/conversation-list.js';
import { resolveSessionFile } from '../../../lib/overdeck/conversation-reads.js';
import { getOverdeckHome } from '../../../lib/paths.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { findProjectKeyByPath } from '../../../lib/projects/project-key.js';
import { listExternalCandidates, type ExternalDirectoryCandidate } from './agent-directory-external.js';
import { SUBAGENT_WORKING_MTIME_MS, listAgentSubagents, listTranscriptSubagents } from './agent-subagents.js';
import { getBackendPanes } from './backend-inventory.js';

export const DIRECTORY_DEFAULT_WINDOW_HOURS = 24;
export const DIRECTORY_MAX_WINDOW_HOURS = 168;
export const DIRECTORY_MEMO_MS = 3_000;
/** Same limit the frontend's GET /api/conversations uses, so both share one coalesced enrichment. */
export const DIRECTORY_CONVERSATION_LIMIT = 500;
export const DIRECTORY_SUBAGENT_CONCURRENCY = 8;
/**
 * D3 worker rule: an idle worker whose newest report belongs to its last turn
 * is `done`. A worker reports as the last step of a turn and goes idle right
 * after, so the report is at most this much older than the idle transition.
 */
export const WORKER_REPORT_TURN_GRACE_MS = 120_000;
export { SUBAGENT_WORKING_MTIME_MS };

const UNASSIGNED_PROJECT = 'unassigned';
const HOUR_MS = 3_600_000;

/** The conversation-list fields the directory reads (conversation-list.ts enrichment). */
export interface DirectoryConversationRow {
  readonly name: string;
  readonly tmuxSession: string;
  readonly title: string | null;
  readonly harness: string | null;
  readonly model: string | null;
  readonly issueId: string | null;
  readonly projectKey: string | null;
  readonly cwd: string;
  readonly createdAt: string;
  readonly endedAt: string | null;
  readonly lastActivityAt: string | null;
  readonly sessionAlive: boolean;
  readonly isWorking: boolean;
  readonly pendingInputCount: number;
  readonly totalCost: number | null;
  /** PAN-4223: the parent link and lane facts; absent on rows from older enrichments. */
  readonly parentConversationId?: number | null;
  readonly parentConversationName?: string | null;
  readonly gauntletRun?: string | null;
  readonly laneKey?: string | null;
  readonly laneRole?: string | null;
  readonly laneIteration?: number | null;
  readonly laneReport?: { readonly status: 'done' | 'blocked' | 'failed' } | null;
  /** PAN-4223 WI-23: the critic link and verdicts from the list enrichment. */
  readonly criticOfConversationId?: number | null;
  readonly criticOfConversationName?: string | null;
  readonly laneVerdict?: { readonly value: string } | null;
  readonly laneLatestVerdict?: { readonly value: string } | null;
}

/** One subagent as a directory source reports it. */
export interface DirectorySubagent {
  readonly agentId: string;
  readonly agentType: string;
  readonly description: string;
  readonly mtimeMs: number | null;
  /** The model the subagent's transcript names; the parent's model is used when null. */
  readonly model?: string | null;
}

export interface AgentDirectoryDeps {
  readonly now?: () => number;
  readonly listAgentStates?: () => readonly AgentState[] | Promise<readonly AgentState[]>;
  readonly getBackendPanes?: () => Promise<readonly BackendPane[]>;
  readonly listConversations?: () => Promise<readonly unknown[]>;
  readonly readRemoteState?: (agentId: string) => Promise<RemoteStateFacts | null>;
  readonly listConversationSubagents?: (row: DirectoryConversationRow) => Promise<readonly DirectorySubagent[]>;
  readonly listAgentSubagents?: (agentId: string, workspace: string) => Promise<readonly DirectorySubagent[]>;
  /** Mtime (epoch ms) of a worker's newest report (PAN-3920 W15). */
  readonly latestWorkerReportAt?: (agentId: string) => Promise<number | null>;
  /** The optional `--name` label from a worker's worker.json. */
  readonly readWorkerName?: (agentId: string) => Promise<string | null>;
  /** Phase C: external registrations as candidates (default: agent-directory-external.ts). */
  readonly listExternalEntries?: (now: number) => Promise<readonly ExternalDirectoryCandidate[]>;
  readonly projectKeyForIssue?: (issueId: string) => string | null;
  /** Issue id (uppercase) → title, from the tracker cache the dashboard already holds. */
  readonly issueTitles?: () => ReadonlyMap<string, string> | Promise<ReadonlyMap<string, string>>;
  readonly projectKeyForPath?: (path: string) => string | null;
  /** Issue id (uppercase) → derived pipeline state; the live scope reads it (PAN-4197). */
  readonly derivedIssueStates?: () => ReadonlyMap<string, DerivedIssueState> | Promise<ReadonlyMap<string, DerivedIssueState>>;
}

/** The `remote-state.json` facts the directory reads. */
export interface RemoteStateFacts {
  readonly location: string | null;
  readonly status: string | null;
  /** When the current remote run started; a state.json stop older than this is a previous run's. */
  readonly startedAt?: string | null;
}

// ─── default sources ─────────────────────────────────────────────────────────

async function defaultReadRemoteState(agentId: string): Promise<RemoteStateFacts | null> {
  try {
    const raw = await readFile(join(getOverdeckHome(), 'agents', agentId, 'remote-state.json'), 'utf8');
    const parsed = JSON.parse(raw) as { location?: unknown; status?: unknown; startedAt?: unknown };
    return {
      location: typeof parsed.location === 'string' ? parsed.location : null,
      status: typeof parsed.status === 'string' ? parsed.status : null,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : null,
    };
  } catch {
    return null;
  }
}

/**
 * Issue titles from the shared issue service's cache (the same tracker data the
 * read model serves the dashboard). Never a live tracker call: an issue the
 * cache does not hold simply has no title.
 */
async function defaultIssueTitles(): Promise<ReadonlyMap<string, string>> {
  try {
    const { getSharedIssueService } = await import('./issue-service-singleton.js');
    const titles = new Map<string, string>();
    for (const issue of getSharedIssueService().getIssues({ includeCompleted: true }) as unknown[]) {
      if (typeof issue !== 'object' || issue === null) continue;
      const { identifier, title } = issue as { identifier?: unknown; title?: unknown };
      if (typeof identifier === 'string' && typeof title === 'string' && title.trim()) {
        titles.set(identifier.toUpperCase(), title.trim());
      }
    }
    return titles;
  } catch {
    return new Map();
  }
}

/** Derived pipeline states from the shared issue service's cache; empty on any error. */
async function defaultDerivedIssueStates(): Promise<ReadonlyMap<string, DerivedIssueState>> {
  try {
    const { getSharedIssueService } = await import('./issue-service-singleton.js');
    return new Map(getSharedIssueService().listDerivedStates().map((derived) => [derived.issueId.toUpperCase(), derived]));
  } catch {
    return new Map();
  }
}

/** Directory reads never write lifecycle log lines (D1). */
const QUIET_RESOLVE = { resolveOptions: { logDiagnostic: () => {} } } as const;

async function defaultReadWorkerName(agentId: string): Promise<string | null> {
  return (await readWorkerFacts(agentId))?.name ?? null;
}

function defaultListAgentStates(): Promise<readonly AgentState[]> {
  return listAgentStatesAsync({ skip: (name) => name.startsWith('conv-') });
}

/** Memoize a lookup for one build, so projects.yaml is consulted once per distinct key. */
function perBuild(lookup: (key: string) => string | null): (key: string) => string | null {
  const seen = new Map<string, string | null>();
  return (key) => {
    if (!seen.has(key)) seen.set(key, lookup(key));
    return seen.get(key)!;
  };
}

async function defaultListConversationSubagents(row: DirectoryConversationRow): Promise<readonly DirectorySubagent[]> {
  const kind = getHarnessBehavior(row.harness as HarnessName | null).transcriptKind;
  const transcriptKind = kind === 'claude-jsonl' ? 'claude' : kind === 'codex-rollout-jsonl' ? 'codex' : null;
  if (!transcriptKind) return [];
  const path = await resolveSessionFile(row as unknown as Parameters<typeof resolveSessionFile>[0]);
  if (!path) return [];
  return listTranscriptSubagents({ kind: transcriptKind, path });
}

function defaultProjectKeyForIssue(issueId: string): string | null {
  try {
    return resolveProjectFromIssueSync(issueId)?.projectKey ?? null;
  } catch {
    return null;
  }
}

function defaultProjectKeyForPath(path: string): string | null {
  try {
    return findProjectKeyByPath(path);
  } catch {
    return null;
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function isConversationRow(value: unknown): value is DirectoryConversationRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === 'string' && typeof row.tmuxSession === 'string' && typeof row.createdAt === 'string';
}

/** Live entries are always in the directory; the rest only inside the window (D4). */
export function isLiveDirectoryState(state: DirectoryEntryState): boolean {
  return state !== 'stopped' && state !== 'done';
}

/**
 * The state.json pause gate as a directory fact (PAN-4197 FR-3): who paused
 * the agent, why and since when. Undefined unless the agent is paused.
 */
export function pauseFacts(state: AgentState): DirectoryPause | undefined {
  if (state.paused !== true) return undefined;
  return {
    by: isOperatorPause(state) ? 'operator' : state.yieldedByScheduler === true ? 'scheduler' : 'machine',
    reason: state.pausedReason ?? null,
    since: state.pausedAt ?? state.yieldedAt ?? null,
  };
}

function paneState(pane: BackendPane | undefined): DirectoryEntryState {
  if (!pane) return 'stopped';
  return pane.state === 'exited' ? 'stopped' : pane.state;
}

/**
 * D3 worker rule: as a native agent, except an idle pane whose newest report
 * belongs to the turn that just ended is `done`.
 */
function workerState(pane: BackendPane | undefined, latestReportAt: number | null): DirectoryEntryState {
  const state = paneState(pane);
  if (state !== 'idle' || latestReportAt === null) return state;
  const idleSince = pane?.stateSince;
  if (idleSince === undefined || latestReportAt >= idleSince - WORKER_REPORT_TURN_GRACE_MS) return 'done';
  return state;
}

function conversationState(row: DirectoryConversationRow): DirectoryEntryState {
  if (!row.sessionAlive) return 'stopped';
  if (row.pendingInputCount > 0) return 'blocked';
  return row.isWorking ? 'working' : 'idle';
}

function isoFromMs(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function timeOf(iso: string | null): number {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function nativeLabel(state: AgentState, workerName: string | null): string {
  if (state.role === 'worker') {
    const issue = state.issueId ? state.issueId.toUpperCase() : state.id;
    return `worker · ${issue} · ${workerName ?? workerNumber(state.id) ?? state.id}`;
  }
  const role = state.role === 'review' && state.reviewSubRole ? `review/${state.reviewSubRole}` : state.role;
  return state.issueId ? `${role} · ${state.issueId.toUpperCase()}` : `${role} · ${state.id}`;
}

/**
 * True when state.json records a stop or failure written after the current
 * remote run started. With no readable remote start, a stop cannot be dated
 * against the run and is trusted.
 */
function stateStoppedSinceRemoteStart(state: AgentState, remoteStartedAt: string | null): boolean {
  if (state.status !== 'stopped' && state.status !== 'error') return false;
  const remoteStart = remoteStartedAt ? Date.parse(remoteStartedAt) : Number.NaN;
  if (!Number.isFinite(remoteStart)) return true;
  const stoppedAt = Math.max(timeOf(state.stoppedAt ?? null), timeOf(state.lastActivity ?? null));
  return stoppedAt > remoteStart;
}

/** Candidate plus the path used for the D5 project fallback; `cwd` never leaves the server. */
interface Candidate {
  entry: DirectoryEntry;
  cwd: string | null;
  explicitProjectKey: string | null;
}

// ─── build ───────────────────────────────────────────────────────────────────

export function clampWindowHours(windowHours: number): number {
  if (!Number.isFinite(windowHours)) return DIRECTORY_DEFAULT_WINDOW_HOURS;
  return Math.min(DIRECTORY_MAX_WINDOW_HOURS, Math.max(1, Math.floor(windowHours)));
}

export async function buildAgentDirectory(
  windowHours: number,
  deps: AgentDirectoryDeps = {},
): Promise<AgentDirectoryResponse> {
  const now = (deps.now ?? Date.now)();
  const hours = clampWindowHours(windowHours);
  const windowMs = hours * HOUR_MS;
  const all = await buildDirectoryEntries(now, deps);

  // 7. Window (D4).
  const kept = new Set<string>();
  for (const entry of all) {
    const inWindow = entry.lastActivityAt !== null && now - timeOf(entry.lastActivityAt) <= windowMs;
    if (isLiveDirectoryState(entry.state) || inWindow) kept.add(entry.id);
  }

  return { generatedAt: new Date(now).toISOString(), windowHours: hours, scope: 'window', entries: keepWithAncestors(all, kept) };
}

/** Issue states in which an issue's last agent is waiting on the pipeline (FR-2 rule 3). */
export const LIVE_PIPELINE_ISSUE_STATES: ReadonlySet<IssueState> = new Set<IssueState>(['in-review', 'changes-requested', 'ready']);

const FINISHED_ISSUE_STATES: ReadonlySet<IssueState> = new Set<IssueState>(['merged', 'closed']);

function isIssueAgent(entry: DirectoryEntry): boolean {
  return entry.kind === 'agent' && (entry.role === 'work' || entry.role === 'strike');
}

/**
 * The live scope (PAN-4197 FR-2): what is running or waiting now, with no time
 * window. An entry is kept when it is live, when it is a paused native agent
 * of an issue that is not merged or closed (or of no issue), or when it is the
 * newest work/strike agent of an issue waiting in the pipeline.
 */
export async function buildLiveAgentDirectory(deps: AgentDirectoryDeps = {}): Promise<AgentDirectoryResponse> {
  const now = (deps.now ?? Date.now)();
  const [all, derived] = await Promise.all([
    buildDirectoryEntries(now, deps),
    Promise.resolve((deps.derivedIssueStates ?? defaultDerivedIssueStates)())
      .catch(() => new Map<string, DerivedIssueState>()),
  ]);
  const issueState = (issueId: string | null) => (issueId ? derived.get(issueId)?.state : undefined);

  const kept = new Set<string>();
  const newestIssueAgent = new Map<string, DirectoryEntry>();
  for (const entry of all) {
    if (isLiveDirectoryState(entry.state)) kept.add(entry.id);
    const state = issueState(entry.issueId);
    if (entry.pause && entry.source === 'overdeck' && !(state && FINISHED_ISSUE_STATES.has(state))) kept.add(entry.id);
    if (entry.issueId && isIssueAgent(entry)) {
      const newest = newestIssueAgent.get(entry.issueId);
      const newer = !newest
        || timeOf(entry.startedAt) > timeOf(newest.startedAt)
        || (timeOf(entry.startedAt) === timeOf(newest.startedAt) && entry.id.localeCompare(newest.id) > 0);
      if (newer) newestIssueAgent.set(entry.issueId, entry);
    }
  }
  for (const [issueId, entry] of newestIssueAgent) {
    const state = issueState(issueId);
    if (state && LIVE_PIPELINE_ISSUE_STATES.has(state)) kept.add(entry.id);
  }

  return { generatedAt: new Date(now).toISOString(), windowHours: 0, scope: 'live', entries: keepWithAncestors(all, kept) };
}

/** A successor's edge to its predecessor (PAN-4223 D23): a conversation entry with a parent and no lane. */
function isSuccessionEdge(entry: DirectoryEntry | undefined): boolean {
  return entry?.kind === 'conversation' && !entry.lane && entry.parentId !== null;
}

/**
 * Re-adds every ancestor of a kept entry, then sorts: live first, last activity
 * descending, then id. The walk never climbs a succession edge (D23): a live
 * successor keeps its own row and does not pull its ended predecessor in.
 */
function keepWithAncestors(all: readonly DirectoryEntry[], kept: Set<string>): DirectoryEntry[] {
  const byId = new Map(all.map((entry) => [entry.id, entry]));
  for (const id of [...kept]) {
    let current = byId.get(id);
    let parentId = isSuccessionEdge(current) ? null : (current?.parentId ?? null);
    while (parentId && byId.has(parentId) && !kept.has(parentId)) {
      kept.add(parentId);
      current = byId.get(parentId);
      parentId = isSuccessionEdge(current) ? null : (current?.parentId ?? null);
    }
  }
  return all.filter((entry) => kept.has(entry.id)).sort((a, b) =>
    Number(isLiveDirectoryState(b.state)) - Number(isLiveDirectoryState(a.state))
    || timeOf(b.lastActivityAt) - timeOf(a.lastActivityAt)
    || a.id.localeCompare(b.id));
}

/** Steps 1–6: every entry the directory can show, before any window or scope. */
async function buildDirectoryEntries(now: number, deps: AgentDirectoryDeps): Promise<DirectoryEntry[]> {
  const readRemoteState = deps.readRemoteState ?? defaultReadRemoteState;
  const projectKeyForIssue = perBuild(deps.projectKeyForIssue ?? defaultProjectKeyForIssue);
  const projectKeyForPath = perBuild(deps.projectKeyForPath ?? defaultProjectKeyForPath);

  const [states, panes, conversationRows, issueTitles, external] = await Promise.all([
    Promise.resolve((deps.listAgentStates ?? defaultListAgentStates)()),
    (deps.getBackendPanes ?? getBackendPanes)().catch(() => [] as readonly BackendPane[]),
    (deps.listConversations ?? (() => getEnrichedConversationList(DIRECTORY_CONVERSATION_LIMIT, 0)))()
      .catch(() => [] as readonly unknown[]),
    Promise.resolve((deps.issueTitles ?? defaultIssueTitles)()).catch(() => new Map<string, string>()),
    (deps.listExternalEntries ?? listExternalCandidates)(now).catch(() => [] as readonly ExternalDirectoryCandidate[]),
  ]);

  const candidates: Candidate[] = [];
  const claimedPanes = new Set<BackendPane>();
  const nativeParents: Array<{ entry: DirectoryEntry; workspace: string }> = [];

  // 1. Native agents (never conversation agent dirs).
  const natives = states.filter((state) => !state.id.startsWith('conv-'));
  const latestReportAt = deps.latestWorkerReportAt ?? defaultLatestWorkerReportAt;
  const readWorkerName = deps.readWorkerName ?? defaultReadWorkerName;
  const [remotes, workerFacts] = await Promise.all([
    Promise.all(natives.map((state) => readRemoteState(state.id))),
    Promise.all(natives.map(async (state) => state.role === 'worker'
      ? {
          reportAt: await latestReportAt(state.id).catch(() => null),
          name: await readWorkerName(state.id).catch(() => null),
        }
      : null)),
  ]);
  natives.forEach((state, index) => {
    const matching = panes.filter((pane) => pane.agentId === state.id || (!pane.agentId && pane.id === state.id));
    const pane = matching.find((candidate) => candidate.state !== 'exited') ?? matching[0];
    for (const claimed of matching) claimedPanes.add(claimed);
    const remoteState = remotes[index];
    const remote = remoteState?.location === 'remote';
    // A remote agent's terminal is on the Fly VM: unknown while it runs, stopped once
    // remote-state.json says it stopped or failed, so it windows out (D3/D4).
    // `pan kill` with the remote unreachable writes only state.json, so its stop
    // counts too, but only when it is newer than the current remote run: a
    // relaunch writes only remote-state.json over a previous run's stop.
    const remoteStopped = remote && (
      remoteState?.status === 'stopped' || remoteState?.status === 'error'
      || stateStoppedSinceRemoteStart(state, remoteState?.startedAt ?? null)
    );
    const worker = workerFacts[index];
    const localState = worker ? workerState(pane, worker.reportAt) : paneState(pane);
    const pause = pauseFacts(state);
    const entry: DirectoryEntry = {
      id: state.id,
      kind: 'agent',
      label: nativeLabel(state, worker?.name ?? null),
      location: remote ? 'remote' : 'local',
      projectKey: UNASSIGNED_PROJECT,
      issueId: state.issueId ? state.issueId.toUpperCase() : null,
      issueTitle: null,
      parentId: state.parentId ?? null,
      role: state.role,
      harness: state.harness ?? pane?.harness ?? 'unknown',
      model: state.model || pane?.model || 'unknown',
      state: remoteStopped ? 'stopped' : remote ? 'unknown' : localState,
      startedAt: state.startedAt ?? null,
      lastActivityAt: state.lastActivity ?? state.stoppedAt ?? state.startedAt ?? null,
      costUsd: null,
      source: 'overdeck',
      transcript: { route: 'agent', agentId: state.id },
      ...(pause ? { pause } : {}),
    };
    candidates.push({ entry, cwd: state.workspace || null, explicitProjectKey: null });
    if (entry.state !== 'stopped') nativeParents.push({ entry, workspace: state.workspace ?? '' });
  });

  // 2. Pane-only agents: Overdeck-tokened panes with no state.json (`pan spawn`).
  for (const pane of panes) {
    if (claimedPanes.has(pane)) continue;
    const key = pane.agentId ?? pane.id;
    if (key.startsWith('conv-')) continue;
    if (!pane.agentId && !pane.issue) continue; // an operator shell Overdeck never stamped
    const since = isoFromMs(pane.stateSince);
    candidates.push({
      entry: {
        id: pane.agentId ?? `pane:${pane.id}`,
        kind: 'agent',
        label: pane.issue ? `${pane.role} · ${pane.issue.toUpperCase()}` : key,
        location: 'local',
        projectKey: UNASSIGNED_PROJECT,
        issueId: pane.issue ? pane.issue.toUpperCase() : null,
        issueTitle: null,
        parentId: null,
        role: pane.role,
        harness: pane.harness,
        model: pane.model,
        state: paneState(pane),
        startedAt: since,
        lastActivityAt: since,
        costUsd: null,
        source: 'pane',
        transcript: pane.agentId ? { route: 'agent', agentId: pane.agentId } : null,
      },
      cwd: pane.workspace ?? null,
      explicitProjectKey: null,
    });
  }

  // 3. Conversations.
  const conversationParents: Array<{ entry: DirectoryEntry; row: DirectoryConversationRow }> = [];
  const conversationIdBySession = new Map<string, string>();
  for (const row of conversationRows.filter(isConversationRow)) {
    conversationIdBySession.set(row.tmuxSession.toLowerCase(), `conv:${row.name}`);
    conversationIdBySession.set(row.name.toLowerCase(), `conv:${row.name}`);
    const entry: DirectoryEntry = {
      id: `conv:${row.name}`,
      kind: 'conversation',
      label: row.title || row.name,
      location: 'local',
      projectKey: UNASSIGNED_PROJECT,
      issueId: row.issueId ? row.issueId.toUpperCase() : null,
      issueTitle: null,
      // PAN-4223: a critic nests under the builder it judges (D27), every
      // other row by its parent link, lanes and successors alike.
      parentId: row.criticOfConversationName
        ? `conv:${row.criticOfConversationName}`
        : (row.parentConversationName ? `conv:${row.parentConversationName}` : null),
      role: null,
      harness: row.harness ?? 'unknown',
      model: row.model ?? 'unknown',
      state: conversationState(row),
      startedAt: row.createdAt,
      lastActivityAt: row.lastActivityAt ?? row.endedAt ?? row.createdAt,
      costUsd: typeof row.totalCost === 'number' ? row.totalCost : null,
      source: 'conversation',
      transcript: { route: 'conversation', conversationName: row.name },
      ...(row.laneKey
        ? {
            lane: {
              run: row.gauntletRun ?? '',
              key: row.laneKey,
              role: row.laneRole ?? 'builder',
              iteration: row.laneIteration ?? 1,
              reportStatus: row.laneReport?.status ?? null,
              verdict: row.laneVerdict?.value ?? row.laneLatestVerdict?.value ?? null,
              ...(row.criticOfConversationId != null ? { criticOf: row.criticOfConversationId } : {}),
            },
          }
        : {}),
      ...(!row.laneKey && row.parentConversationId != null ? { continuesFrom: row.parentConversationId } : {}),
    };
    candidates.push({ entry, cwd: row.cwd || null, explicitProjectKey: row.projectKey });
    if (entry.state !== 'stopped') conversationParents.push({ entry, row });
  }

  // A native agent whose id is a conversation's tmux session is that
  // conversation's own pane (e.g. `sequencer-runner`): one pane, one row. The
  // conversation keeps it, with its composer (PAN-4197).
  const conversationSessions = new Set(conversationRows.filter(isConversationRow).map((row) => row.tmuxSession.toLowerCase()));
  const isConversationPane = (entry: DirectoryEntry) =>
    entry.kind === 'agent' && entry.source === 'overdeck' && conversationSessions.has(entry.id.toLowerCase());
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (isConversationPane(candidates[index]!.entry)) candidates.splice(index, 1);
  }
  for (let index = nativeParents.length - 1; index >= 0; index -= 1) {
    if (isConversationPane(nativeParents[index]!.entry)) nativeParents.splice(index, 1);
  }

  // 4. External agents (Phase C). They join before the parent remap so a
  //    registration naming a conversation's tmux session nests under it.
  for (const { entry, cwd } of external) candidates.push({ entry, cwd, explicitProjectKey: null });

  // A worker or external agent spawned by a conversation names its tmux session
  // (OVERDECK_CONVERSATION); point it at that conversation's entry so it nests under it (D6).
  for (const candidate of candidates) {
    const parent = candidate.entry.parentId;
    const conversationId = parent ? conversationIdBySession.get(parent.toLowerCase()) : undefined;
    if (conversationId) candidate.entry = { ...candidate.entry, parentId: conversationId };
  }

  // 5. Subagents of every non-stopped parent.
  const listConversationSubagents = deps.listConversationSubagents ?? defaultListConversationSubagents;
  const listNativeSubagents = deps.listAgentSubagents
    ?? ((agentId: string, workspace: string) => listAgentSubagents(agentId, workspace, QUIET_RESOLVE));
  const subagentTasks: Array<() => Promise<Candidate[]>> = [
    ...conversationParents.map(({ entry, row }) => () => listConversationSubagents(row)
      .then((subs) => subagentCandidates(entry, subs, 'conversation', row.name, row.cwd, now))),
    ...nativeParents.map(({ entry, workspace }) => () => listNativeSubagents(entry.id, workspace)
      .then((subs) => subagentCandidates(entry, subs, 'agent', entry.id, workspace, now))),
  ].map((task) => () => task().catch(() => [] as Candidate[]));
  for (const batch of await withConcurrencyLimit(subagentTasks, DIRECTORY_SUBAGENT_CONCURRENCY)) {
    candidates.push(...batch);
  }

  // 6. Project keys (D5): issue → the row's own project → cwd → unassigned.
  //    A subagent inherits its parent's key (parents precede their subagents).
  const projectKeys = new Map<string, string>();
  return candidates.map(({ entry, cwd, explicitProjectKey }) => {
    const inherited = entry.kind === 'subagent' && entry.parentId ? projectKeys.get(entry.parentId) : undefined;
    const projectKey = inherited
      ?? (entry.issueId ? projectKeyForIssue(entry.issueId) : null)
      ?? explicitProjectKey
      ?? (cwd ? projectKeyForPath(cwd) : null)
      ?? UNASSIGNED_PROJECT;
    projectKeys.set(entry.id, projectKey);
    return { ...entry, projectKey, issueTitle: entry.issueId ? issueTitles.get(entry.issueId) ?? null : null };
  });
}

function subagentCandidates(
  parent: DirectoryEntry,
  subagents: readonly DirectorySubagent[],
  route: 'conversation' | 'agent',
  parentKey: string,
  cwd: string | null,
  now: number,
): Candidate[] {
  return subagents.map((sub) => {
    const working = parent.state !== 'stopped' && sub.mtimeMs !== null && now - sub.mtimeMs <= SUBAGENT_WORKING_MTIME_MS;
    const activity = isoFromMs(sub.mtimeMs);
    return {
      entry: {
        id: `sub:${parent.id}:${sub.agentId}`,
        kind: 'subagent',
        label: truncate(`${sub.agentType} · ${sub.description}`, 80),
        location: parent.location,
        projectKey: UNASSIGNED_PROJECT,
        issueId: parent.issueId,
        issueTitle: null,
        parentId: parent.id,
        role: null,
        harness: parent.harness,
        model: sub.model || parent.model,
        state: working ? 'working' : 'done',
        startedAt: null,
        lastActivityAt: activity,
        costUsd: null,
        source: getHarnessBehavior(parent.harness as HarnessName).transcriptKind === 'codex-rollout-jsonl'
          ? 'codex-subagent'
          : 'claude-subagent',
        transcript: route === 'conversation'
          ? { route: 'conversation-subagent', conversationName: parentKey, subagentId: sub.agentId }
          : { route: 'agent-subagent', agentId: parentKey, subagentId: sub.agentId },
      },
      cwd,
      explicitProjectKey: null,
    };
  });
}

// ─── memoized read door ──────────────────────────────────────────────────────

let memo = createSettledTtlPromiseCache<number, AgentDirectoryResponse>(DIRECTORY_MEMO_MS);
let liveMemo = createSettledTtlPromiseCache<number, AgentDirectoryResponse>(DIRECTORY_MEMO_MS);

/** The directory for a window, memoized for 3 s; concurrent callers share one build. */
export function getAgentDirectory(windowHours: number, deps?: AgentDirectoryDeps): Promise<AgentDirectoryResponse> {
  const hours = clampWindowHours(windowHours);
  return memo(hours, () => buildAgentDirectory(hours, deps));
}

/** The live scope, memoized for 3 s like the window answer (PAN-4197 NFR-3). */
export function getLiveAgentDirectory(deps?: AgentDirectoryDeps): Promise<AgentDirectoryResponse> {
  return liveMemo(0, () => buildLiveAgentDirectory(deps));
}

export function _resetAgentDirectoryForTests(): void {
  memo = createSettledTtlPromiseCache<number, AgentDirectoryResponse>(DIRECTORY_MEMO_MS);
  liveMemo = createSettledTtlPromiseCache<number, AgentDirectoryResponse>(DIRECTORY_MEMO_MS);
}
