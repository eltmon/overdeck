/**
 * `deriveFlywheelStatus()` — the one flywheel status deriver (PAN-3964 FR-1,
 * D7, D8).
 *
 * `pan flywheel status`, `GET /api/flywheel/status`, and the Flywheel page all
 * consume this function, which is what makes "the CLI and the page agree"
 * mechanically true. Nothing is stored and nothing is written: every field is
 * computed on read from
 *
 *   - the `conv-flywheel` conversation row and whether its session is alive,
 *   - the newest tick marker in that conversation's transcript,
 *   - the previous run's last tick, from the newest retired
 *     `conv-flywheel~…` conversation (`previous-run.ts`, PAN-5666),
 *   - the project's `workspaces/feature-*` directories, their derived issue
 *     state, and the last entry of each pipeline journal,
 *   - the control-settings policies,
 *   - the `running` order book under the plan home's `.pan/`.
 *
 * Every source is an injectable dependency, so the unit test needs no DB, no
 * terminal backend, and no forge. The defaults import their modules lazily so
 * loading this file stays cheap for the CLI.
 */

import { join } from 'node:path';

import { indexPanesByAgentKey, paneAgentKey } from '@overdeck/contracts';
import type {
  BackendPane,
  DerivedIssueState,
  DerivedPrState,
  FlywheelAgentSummary,
  FlywheelConversationSummary,
  FlywheelDerivedStatus,
  FlywheelFreshness,
  FlywheelInFlightRow,
  FlywheelOrderBookSummary,
  FlywheelPolicies,
} from '@overdeck/contracts';

import type { LegacyConversation } from '../overdeck/conversations.js';
import type { PendingAutoMerge, UatGeneration } from '../overdeck/merge-types.js';
import type { QualityGateMemorySample, QualityGateQueueEntry, QualityGateQueueSnapshot } from '../cloister/quality-gate-admission.js';
import type { LoadedPr, TrackerIssueFacts } from '../overdeck/derived-issue-state.js';
import { isHousekeepingEntry, type PipelineJournalEntry } from '../cloister/pipeline-journal.js';
import {
  FLYWHEEL_CONVERSATION_SESSION,
  FLYWHEEL_FRESHNESS_BREATHING_MS,
  FLYWHEEL_FRESHNESS_LIVE_MS,
} from './constants.js';
import { findLastTick, resolveNeedsYouItems, type TickMarkerMessage } from './tick-marker.js';
import { derivePreviousRun, type PreviousRunDeps } from './previous-run.js';
import {
  activityFrom,
  deriveBlocker,
  deriveCardAgent,
  deriveOwner,
  deriveStage,
  deriveStageSince,
  mapWaiterToIssue,
  type BoardAutoMerge,
  type BoardConversation,
  type BoardFacts,
  type BoardGeneration,
  type GateIssueCandidate,
} from './board.js';

export interface FlywheelWorkspace {
  issueId: string;
  workspacePath: string;
}

export interface DeriveFlywheelStatusDeps {
  getConversation?: (name: string) => LegacyConversation | null | Promise<LegacyConversation | null>;
  sessionAlive?: (tmuxSession: string) => Promise<boolean>;
  readTranscript?: (conv: LegacyConversation) => Promise<readonly TickMarkerMessage[]>;
  /** The retired `conv-flywheel~…` rows, newest first (PAN-5666). */
  listRetiredConversations?: PreviousRunDeps['listRetiredConversations'];
  /** Resolve a directory to its registered project root (null = unregistered). */
  resolveProjectPath?: (dir: string) => string | null | Promise<string | null>;
  resolvePlanHome?: (projectRoot: string) => string | Promise<string>;
  listWorkspaces?: (projectPath: string) => readonly FlywheelWorkspace[] | Promise<readonly FlywheelWorkspace[]>;
  /**
   * The tracker rows for the in-flight ids, by upper-cased id. A `null` entry
   * is unknown — no configured tracker answered — and never a silent "open".
   */
  readTrackerIssues?: (issueIds: readonly string[]) => Promise<Readonly<Record<string, TrackerIssueFacts | null>>>;
  /** The backend pane inventory, read once and shared by the rows and `loadStates`. */
  listPanes?: () => readonly BackendPane[] | Promise<readonly BackendPane[]>;
  loadStates?: (
    projectPath: string,
    issueIds: readonly string[],
    opts: { issues: Readonly<Record<string, TrackerIssueFacts | null>>; panes: readonly BackendPane[] },
  ) => Promise<Map<string, DerivedIssueState>>;
  lastJournal?: (workspacePath: string) => PipelineJournalEntry | null | Promise<PipelineJournalEntry | null>;
  /**
   * Whether the agent behind a `done` or `unknown` pane is still alive
   * (PAN-4666). Herdr `done` means the harness finished its turn and sits at
   * its prompt, not that it exited.
   */
  isAgentAlive?: (agentKey: string) => Promise<boolean>;
  // ── Board facts (PAN-5283 WI-5). Each degrades to "unknown" on failure. ──
  /** The pipeline journal tail, oldest first (D22). */
  journalTail?: (workspacePath: string) => readonly PipelineJournalEntry[] | Promise<readonly PipelineJournalEntry[]>;
  /** The issue's unarchived handoff conversations, newest first. */
  listIssueConversations?: (issueId: string) => readonly LegacyConversation[] | Promise<readonly LegacyConversation[]>;
  /** The issue's work agent `startedBy` provenance. */
  readStartedBy?: (issueId: string) => string | null | Promise<string | null>;
  /** The issue's cost-event aggregate in USD (D21). */
  issueCost?: (issueId: string) => number | null | Promise<number | null>;
  readGateQueue?: () => Promise<QualityGateQueueSnapshot>;
  readMemory?: () => Promise<QualityGateMemorySample | null>;
  softReserveBytes?: () => number | Promise<number>;
  /** The issue's newest auto-merge row in any status. */
  readAutoMerge?: (issueId: string) => PendingAutoMerge | null | Promise<PendingAutoMerge | null>;
  /** The project's assembling or ready window-lane train generations, newest first. */
  listWindowGenerations?: (projectRoot: string) => readonly UatGeneration[] | Promise<readonly UatGeneration[]>;
  /** When train batching resumes for the project, or null (WI-6). */
  batchingPausedUntil?: (projectRoot: string) => string | null | Promise<string | null>;
  /** The issue's open `strike/<id>` PR; null when none is open (PAN-4752). */
  readStrikePr?: (projectPath: string, issueId: string) => DerivedPrState | null | Promise<DerivedPrState | null>;
  policies?: () => FlywheelPolicies | Promise<FlywheelPolicies>;
  runningBook?: (panDir: string) => FlywheelOrderBookSummary | null | Promise<FlywheelOrderBookSummary | null>;
  now?: () => number;
}

export interface DeriveFlywheelStatusOptions {
  /** Used when no flywheel conversation exists; defaults to `process.cwd()`. */
  projectRoot?: string;
  deps?: DeriveFlywheelStatusDeps;
}

export function freshnessFor(atIso: string, nowMs: number): FlywheelFreshness {
  const at = Date.parse(atIso);
  const age = Number.isFinite(at) ? Math.max(0, nowMs - at) : Number.POSITIVE_INFINITY;
  if (age <= FLYWHEEL_FRESHNESS_LIVE_MS) return 'live';
  if (age <= FLYWHEEL_FRESHNESS_BREATHING_MS) return 'breathing';
  return 'stalled';
}

/** `PAN-4669-STRIKE` → `PAN-4669`; null for any id that is not a strike id (PAN-4752). */
export function strikeBaseId(issueId: string): string | null {
  const match = /^(.+)-STRIKE$/i.exec(issueId);
  return match?.[1] ? match[1].toUpperCase() : null;
}

// ─── lazy defaults ───────────────────────────────────────────────────────────

async function defaultGetConversation(name: string): Promise<LegacyConversation | null> {
  const { getConversationByName } = await import('../overdeck/conversations.js');
  return getConversationByName(name);
}

async function defaultSessionAlive(tmuxSession: string): Promise<boolean> {
  const { conversationSessionAlive } = await import('../overdeck/conversation-liveness.js');
  return conversationSessionAlive(tmuxSession);
}

/** The flywheel transcript as parsed messages (lazy default for `readTranscript`). */
export async function readFlywheelTranscript(conv: LegacyConversation): Promise<readonly TickMarkerMessage[]> {
  const { resolveSessionFile, getCachedMessages } = await import('../overdeck/conversation-reads.js');
  const file = await resolveSessionFile(conv);
  if (!file) return [];
  try {
    return (await getCachedMessages(file, false)).messages;
  } catch {
    return [];
  }
}

async function defaultResolveProjectPath(dir: string): Promise<string | null> {
  const { findProjectByPath } = await import('../projects.js');
  return findProjectByPath(dir)?.path ?? null;
}

async function defaultResolvePlanHome(projectRoot: string): Promise<string> {
  const { resolvePlanHome } = await import('../pan-dir/paths.js');
  return resolvePlanHome(projectRoot);
}

async function defaultListWorkspaces(projectPath: string): Promise<readonly FlywheelWorkspace[]> {
  const { listFeatureWorkspaces } = await import('../cloister/deacon-workspaces.js');
  return listFeatureWorkspaces({ includeSlotWorkspaces: false })
    .filter((ws) => ws.projectPath === projectPath)
    .map(({ issueId, workspacePath }) => ({ issueId, workspacePath }));
}

/**
 * Without this read the deriver has no tracker state at all, so a closed issue
 * whose feature branch lingers derives `working` and never leaves the board
 * (PAN-4199). Four at a time keeps a wide board off the tracker's rate limit.
 */
async function defaultReadTrackerIssues(
  issueIds: readonly string[],
): Promise<Readonly<Record<string, TrackerIssueFacts | null>>> {
  const { readIssueFromTracker } = await import('../overdeck/derived-issue-state.js');
  const { withConcurrencyLimit } = await import('../concurrency.js');
  const ids = issueIds.map((id) => id.toUpperCase());
  const facts = await withConcurrencyLimit(ids.map((id) => () => readIssueFromTracker(id)), 4);
  return Object.fromEntries(ids.map((id, i) => [id, facts[i] ?? null]));
}

async function defaultListPanes(): Promise<readonly BackendPane[]> {
  const { listPanesWithBackend } = await import('../overdeck/derived-issue-state.js');
  return listPanesWithBackend(Date.now());
}

async function defaultLoadStates(
  projectPath: string,
  issueIds: readonly string[],
  opts: { issues: Readonly<Record<string, TrackerIssueFacts | null>>; panes: readonly BackendPane[] },
): Promise<Map<string, DerivedIssueState>> {
  const { loadIssueStatesForProject } = await import('../overdeck/derived-issue-state.js');
  return loadIssueStatesForProject(projectPath, issueIds, { issues: opts.issues, panes: opts.panes });
}

/**
 * The one liveness module decides (`src/lib/agents/liveness.ts`). An
 * indeterminate probe, or one that throws, counts as live: a possibly-live
 * agent must never read as "no agent".
 */
async function defaultIsAgentAlive(agentKey: string): Promise<boolean> {
  try {
    const { isAlive } = await import('../agents/liveness.js');
    const verdict = await isAlive(agentKey);
    return verdict.alive || verdict.reason === 'runtime-indeterminate';
  } catch {
    return true;
  }
}

const LIVENESS_PROBE_CONCURRENCY = 4;

/**
 * The panes that are still running agents (PAN-4666): `exited` is dead,
 * `working|blocked|idle` are live, and `done|unknown` are confirmed through
 * the liveness module, four probes at a time.
 */
async function livePanes(
  panes: readonly BackendPane[],
  isAgentAlive: (agentKey: string) => Promise<boolean>,
): Promise<BackendPane[]> {
  const { withConcurrencyLimit } = await import('../concurrency.js');
  const verdicts = await withConcurrencyLimit(panes.map((pane) => async () => {
    if (pane.state === 'exited') return false;
    if (pane.state !== 'done' && pane.state !== 'unknown') return true;
    try {
      return await isAgentAlive(paneAgentKey(pane));
    } catch {
      return true;
    }
  }), LIVENESS_PROBE_CONCURRENCY);
  return panes.filter((_pane, index) => verdicts[index] === true);
}

/**
 * PAN-5648 r4672667750: a `limit`-at-read-time tail could be entirely
 * `stack.*` housekeeping when 50+ of those trail the journal, losing a real
 * pipeline entry (e.g. `blocked.declared`) the Flywheel still needs. Read
 * the whole journal, drop housekeeping, then keep the last 50 of what's left.
 */
export async function readFlywheelJournalTail(workspacePath: string): Promise<readonly PipelineJournalEntry[]> {
  const { readPipelineJournal } = await import('../cloister/pipeline-journal.js');
  const entries = readPipelineJournal(workspacePath).filter((entry) => !isHousekeepingEntry(entry));
  return entries.slice(-JOURNAL_TAIL_LIMIT);
}

async function defaultJournalTail(workspacePath: string): Promise<readonly PipelineJournalEntry[]> {
  return readFlywheelJournalTail(workspacePath);
}

const JOURNAL_TAIL_LIMIT = 50;

async function defaultListIssueConversations(issueId: string): Promise<readonly LegacyConversation[]> {
  const { listIssueConversations } = await import('../overdeck/conversations.js');
  return listIssueConversations(issueId);
}

async function defaultReadStartedBy(issueId: string): Promise<string | null> {
  const { getAgentState } = await import('../agents/agent-state-read.js');
  return getAgentState(`agent-${issueId.toLowerCase()}`)?.startedBy ?? null;
}

async function defaultIssueCost(issueId: string): Promise<number | null> {
  const { getCostForIssueAggregate } = await import('../overdeck/cost-sync.js');
  return getCostForIssueAggregate(issueId)?.totalCost ?? null;
}

async function defaultReadGateQueue(): Promise<QualityGateQueueSnapshot> {
  const { readQualityGateQueue } = await import('../cloister/quality-gate-admission.js');
  return readQualityGateQueue();
}

async function defaultReadMemory(): Promise<QualityGateMemorySample | null> {
  const { readQualityGateMemory } = await import('../cloister/quality-gate-admission.js');
  return readQualityGateMemory();
}

async function defaultSoftReserveBytes(): Promise<number> {
  const { resolveSoftReserveBytes } = await import('../cloister/quality-gate-memory.js');
  return resolveSoftReserveBytes();
}

/**
 * The newest row decides, the same row the scheduler reads: an old failed row
 * behind a newer merged or cancelled one must not pin the card in Merge.
 */
async function defaultReadAutoMerge(issueId: string): Promise<PendingAutoMerge | null> {
  const { getLatestAutoMerge } = await import('../overdeck/merge-sync.js');
  return getLatestAutoMerge(issueId);
}

/** Same name test as `isWindowBatch` in the server's merge-train batching, which `src/lib` must not import. */
const WINDOW_BATCH_RE = /^uat\/[a-z0-9]+-train-/i;

async function defaultListWindowGenerations(projectRoot: string): Promise<readonly UatGeneration[]> {
  const { listUatGenerations } = await import('../overdeck/merge-sync.js');
  return listUatGenerations({ projectRoot, statuses: ['assembling', 'ready'], limit: 20 })
    .filter((gen) => WINDOW_BATCH_RE.test(gen.name));
}

async function defaultBatchingPausedUntil(projectRoot: string): Promise<string | null> {
  const { projectBatchCiPausedUntil } = await import('../cloister/merge-route.js');
  return projectBatchCiPausedUntil(projectRoot);
}

/** A board read that fails, synchronously or not, answers `fallback` (WI-5: never throw the status). */
async function attempt<T>(read: () => T | Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

const ACTIONABLE_AUTO_MERGE = new Set(['pending', 'merging', 'blocked', 'failed']);

function boardAutoMerge(row: PendingAutoMerge | null): BoardAutoMerge | null {
  if (!row || !ACTIONABLE_AUTO_MERGE.has(row.status)) return null;
  return {
    status: row.status as BoardAutoMerge['status'],
    scheduledMergeAt: row.scheduledMergeAt,
    scheduledAt: row.scheduledAt,
    ...(row.failureReason ? { failureReason: row.failureReason } : {}),
  };
}

/**
 * The open PR among those on one strike head, highest number first (PAN-4752).
 * `pan strike` reuses `strike/<id>` on every run, so a merged or closed PR on
 * that head may belong to an earlier strike: it never counts.
 */
export function selectOpenStrikePr(prs: readonly (LoadedPr | null)[]): DerivedPrState | null {
  const open = prs.filter((pr): pr is LoadedPr => pr !== null && !pr.merged).sort((a, b) => b.number - a.number)[0];
  return open ? { url: open.url, number: open.number, reviewState: open.reviewState, checks: open.checks, mergeable: open.mergeable } : null;
}

async function defaultReadStrikePr(projectPath: string, issueId: string): Promise<DerivedPrState | null> {
  const m = await import('../overdeck/derived-issue-state.js');
  const branch = `strike/${issueId.toLowerCase()}`;
  const prs = m.forgeForProject(projectPath) === 'gitlab'
    ? (await m.listRepoMergeRequests(projectPath)).filter((row) => row.source_branch === branch).map(m.mrFromGlabRow)
    : (await m.listRepoPullRequests(projectPath)).filter((row) => row.headRefName === branch).map(m.prFromGhRow);
  return selectOpenStrikePr(prs);
}

async function defaultPolicies(): Promise<FlywheelPolicies> {
  const settings = await import('../overdeck/control-settings.js');
  return {
    auto_pickup_backlog: settings.isFlywheelAutoPickupBacklog(),
    require_uat_before_merge: settings.isFlywheelRequireUatBeforeMerge(),
    merge_train_enabled: settings.isMergeTrainEnabled(),
  };
}

async function defaultRunningBook(panDir: string): Promise<FlywheelOrderBookSummary | null> {
  const { listBooks, computeBookProgress, backfillUnknownOrderIssues } = await import('../orders/resolver.js');
  const { currentOrderBook, isBookFinished } = await import('../orders/phase.js');
  let books;
  try {
    books = listBooks(panDir);
  } catch {
    return null;
  }
  await backfillUnknownOrderIssues(books);
  // The active book, by the rule dispatch and the orders API use (PAN-5599): running, else the first unfinished ready book.
  const book = currentOrderBook(books, (candidate) => isBookFinished(computeBookProgress(candidate)));
  if (!book) return null;
  const progress = computeBookProgress(book);
  return { id: book.id, name: book.name, status: book.status, landed: progress.landed, total: progress.total };
}

/** One conversation row as board facts; its pane state comes from the inventory. */
function boardConversation(conv: LegacyConversation, panesByKey: ReadonlyMap<string, BackendPane>): BoardConversation & { totalCost: number } {
  const pane = panesByKey.get(conv.tmuxSession) ?? panesByKey.get(`conv-${conv.name}`) ?? panesByKey.get(conv.name);
  return {
    name: conv.name,
    title: conv.title,
    model: conv.model,
    harness: conv.harness,
    cwd: conv.cwd,
    status: conv.status,
    tmuxSession: conv.tmuxSession,
    ...(pane ? { paneState: pane.state } : {}),
    totalCost: Number.isFinite(conv.totalCost) ? conv.totalCost : 0,
  };
}

/** Gate tickets by the in-flight issue they belong to (D10), oldest first. */
function groupGateEntries(
  entries: readonly QualityGateQueueEntry[],
  candidates: readonly GateIssueCandidate[],
): Map<string, QualityGateQueueEntry[]> {
  const byId = new Map<string, QualityGateQueueEntry[]>();
  for (const entry of entries) {
    const id = mapWaiterToIssue(entry, candidates);
    if (!id) continue;
    const list = byId.get(id);
    if (list) list.push(entry); else byId.set(id, [entry]);
  }
  for (const list of byId.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  return byId;
}

interface BoardShared {
  gateQueue: QualityGateQueueSnapshot | null;
  memory: QualityGateMemorySample | null;
  softReserveBytes: number | null;
  generationById: Map<string, BoardGeneration>;
  batchingPausedUntil: string | null;
}

/** The board reads shared by every row, once per status; each failure reads as unknown. */
async function readBoardShared(projectRoot: string, any: boolean, deps: DeriveFlywheelStatusDeps): Promise<BoardShared> {
  if (!any) return { gateQueue: null, memory: null, softReserveBytes: null, generationById: new Map(), batchingPausedUntil: null };
  const [gateQueue, memory, softReserveBytes, generations, batchingPausedUntil] = await Promise.all([
    attempt<QualityGateQueueSnapshot | null>(() => (deps.readGateQueue ?? defaultReadGateQueue)(), null),
    attempt(() => (deps.readMemory ?? defaultReadMemory)(), null),
    attempt<number | null>(() => (deps.softReserveBytes ?? defaultSoftReserveBytes)(), null),
    attempt<readonly UatGeneration[]>(() => (deps.listWindowGenerations ?? defaultListWindowGenerations)(projectRoot), []),
    attempt(() => (deps.batchingPausedUntil ?? defaultBatchingPausedUntil)(projectRoot), null),
  ]);
  // Generations arrive newest first, so the newest batch an issue sits in wins.
  const generationById = new Map<string, BoardGeneration>();
  for (const gen of generations) {
    for (const member of gen.members) {
      const id = member.issueId.toUpperCase();
      if (!generationById.has(id)) generationById.set(id, { name: gen.name, createdAt: gen.createdAt, memberCount: gen.members.length });
    }
  }
  return { gateQueue, memory, softReserveBytes, generationById, batchingPausedUntil };
}

/** USD for the card (D21): the cost-event aggregate, else the handoff conversations' total, else unknown. */
function cardCost(aggregate: number | null, conversations: readonly { totalCost?: number }[]): number | null {
  if (typeof aggregate === 'number' && aggregate > 0) return aggregate;
  const total = conversations.reduce((sum, conv) => sum + (conv.totalCost ?? 0), 0);
  return total > 0 ? total : null;
}

/** The board fields of one row (FR-1); a derivation that throws leaves them out. */
function boardFields(
  facts: BoardFacts,
  aggregateCost: number | null,
  conversations: readonly { totalCost?: number }[],
): Partial<FlywheelInFlightRow> {
  try {
    const stage = deriveStage(facts);
    return {
      stage,
      stageSince: deriveStageSince(facts, stage),
      owner: deriveOwner(facts),
      agent: deriveCardAgent(facts),
      blocker: deriveBlocker(facts),
      cost: cardCost(aggregateCost, conversations),
      lastActivity: activityFrom(facts.journal[facts.journal.length - 1]),
    };
  } catch {
    return {};
  }
}

// ─── the deriver ─────────────────────────────────────────────────────────────

export interface FlywheelRunRead {
  conv: LegacyConversation | null;
  sessionAlive: boolean;
  run: FlywheelDerivedStatus['run'];
}

/**
 * The run-state predicate, shared by the deriver and the actions (D5):
 * `running` = row, `active`, not mid-fork, session alive; `paused` = a row
 * that is not running (stopped, crashed, or ended); `idle` = no row, or an
 * archived one (a failed start is rolled back by archiving its row).
 */
export async function readFlywheelRun(
  deps: Pick<DeriveFlywheelStatusDeps, 'getConversation' | 'sessionAlive'> = {},
): Promise<FlywheelRunRead> {
  const row = await (deps.getConversation ?? defaultGetConversation)(FLYWHEEL_CONVERSATION_SESSION);
  const conv = row && !row.archivedAt ? row : null;
  const sessionAlive = conv
    ? conv.status === 'active' && !conv.forkStatus && await (deps.sessionAlive ?? defaultSessionAlive)(conv.tmuxSession)
    : false;
  return { conv, sessionAlive, run: !conv ? 'idle' : sessionAlive ? 'running' : 'paused' };
}

/**
 * The flywheel's project root and plan home (D8): the conversation's cwd when
 * a flywheel conversation exists, else `opts.projectRoot`, else the process
 * cwd — resolved to its registered project.
 */
export async function resolveFlywheelProjectRoot(
  opts: DeriveFlywheelStatusOptions = {},
): Promise<{ projectRoot: string; planHome: string }> {
  const deps = opts.deps ?? {};
  const conv = await (deps.getConversation ?? defaultGetConversation)(FLYWHEEL_CONVERSATION_SESSION);
  return resolveRoots(conv?.cwd ?? opts.projectRoot ?? process.cwd(), deps);
}

async function resolveRoots(baseDir: string, deps: DeriveFlywheelStatusDeps): Promise<{ projectRoot: string; planHome: string }> {
  const projectRoot = (await (deps.resolveProjectPath ?? defaultResolveProjectPath)(baseDir)) ?? baseDir;
  return { projectRoot, planHome: await (deps.resolvePlanHome ?? defaultResolvePlanHome)(projectRoot) };
}

export async function deriveFlywheelStatus(options: DeriveFlywheelStatusOptions = {}): Promise<FlywheelDerivedStatus> {
  const deps = options.deps ?? {};
  const now = (deps.now ?? Date.now)();

  const { conv, sessionAlive, run } = await readFlywheelRun(deps);

  const conversation: FlywheelConversationSummary | null = conv
    ? {
        name: conv.name,
        id: conv.id,
        title: conv.title,
        model: conv.model,
        harness: conv.harness,
        cwd: conv.cwd,
        createdAt: conv.createdAt,
        sessionAlive,
      }
    : null;

  const readTranscript = deps.readTranscript ?? readFlywheelTranscript;
  const messages = conv ? await readTranscript(conv) : [];
  const newestTick = findLastTick(messages);
  const lastTick = newestTick ? { ...newestTick, needsYouItems: resolveNeedsYouItems(messages) } : null;
  // The run before this one (PAN-5666). Its in-flight ids stay out of the
  // board: only the running loop's own tick names what it drives.
  const previousRun = await derivePreviousRun(conv, {
    readTranscript,
    ...(deps.listRetiredConversations ? { listRetiredConversations: deps.listRetiredConversations } : {}),
  });

  const { projectRoot, planHome } = await resolveRoots(conv?.cwd ?? options.projectRoot ?? process.cwd(), deps);
  const panDir = join(planHome, '.pan');

  const workspaces = await (deps.listWorkspaces ?? defaultListWorkspaces)(projectRoot);
  // The board is the union of the workspace census and the ids the loop named
  // in its own newest tick: an issue the loop is driving without a workspace
  // of its own is still in flight, and a workspace the loop has not picked up
  // is still real. Census order first, then the tick-only ids. A `-STRIKE`
  // workspace or tick id folds onto its base issue row (PAN-4752): the base
  // workspace's path wins for the journal regardless of arrival order.
  type Candidate = { issueId: string; workspacePath: string | null; inTick: boolean; strike: boolean };
  const candidates: Candidate[] = [];
  const byId = new Map<string, Candidate>();
  const tickIds = new Set((lastTick?.inFlight ?? []).map((id) => strikeBaseId(id) ?? id.toUpperCase()));
  const tickStrikeIds = new Set((lastTick?.inFlight ?? []).map(strikeBaseId).filter((id): id is string => id !== null));
  for (const ws of workspaces) {
    const base = strikeBaseId(ws.issueId);
    const id = base ?? ws.issueId.toUpperCase();
    const existing = byId.get(id);
    if (existing) {
      // A strike workspace folds onto its base issue; the base workspace's journal wins.
      if (base) existing.strike = true;
      else existing.workspacePath = ws.workspacePath;
      continue;
    }
    const candidate: Candidate = { issueId: base ?? ws.issueId, workspacePath: ws.workspacePath, inTick: tickIds.has(id), strike: base !== null };
    byId.set(id, candidate);
    candidates.push(candidate);
  }
  for (const id of tickIds) {
    const existing = byId.get(id);
    if (existing) { if (tickStrikeIds.has(id)) existing.strike = true; continue; }
    const candidate: Candidate = { issueId: id, workspacePath: null, inTick: true, strike: tickStrikeIds.has(id) };
    byId.set(id, candidate);
    candidates.push(candidate);
  }
  const issueIds = candidates.map((c) => c.issueId);
  // The tracker read comes first: `loadIssueStatesForProject` treats a missing
  // entry as unknown, so passing it through is what makes `closed` reachable.
  // One inventory read for the whole status: the rows count live agents from
  // it and `loadStates` derives pane-driven attention from the same snapshot.
  const [issues, panes] = candidates.length
    ? await Promise.all([
        (deps.readTrackerIssues ?? defaultReadTrackerIssues)(issueIds),
        (deps.listPanes ?? defaultListPanes)(),
      ])
    : [{} as Readonly<Record<string, TrackerIssueFacts | null>>, [] as readonly BackendPane[]];
  const states = candidates.length
    ? await (deps.loadStates ?? defaultLoadStates)(projectRoot, issueIds, { issues, panes })
    : new Map<string, DerivedIssueState>();
  const livePanesByIssue = new Map<string, BackendPane[]>();
  // Probe only the panes of issues on this board (H3): every poll would
  // otherwise probe every finished pane in the inventory.
  const candidateIds = new Set(issueIds.map((id) => id.toUpperCase()));
  const issuePanes = panes.filter((pane) => pane.issue && candidateIds.has(pane.issue.toUpperCase()));
  for (const pane of await livePanes(issuePanes, deps.isAgentAlive ?? defaultIsAgentAlive)) {
    if (!pane.issue) continue;
    const id = pane.issue.toUpperCase();
    const list = livePanesByIssue.get(id);
    if (list) list.push(pane); else livePanesByIssue.set(id, [pane]);
  }
  const board = await readBoardShared(projectRoot, candidates.length > 0, deps);
  const panesByKey = indexPanesByAgentKey(panes);
  // First pass: each issue's handoff conversations, so a gate ticket in a
  // `hoff-*` worktree maps to its issue through the conversation's cwd (D10).
  const conversationsById = new Map<string, (BoardConversation & { totalCost: number })[]>();
  await Promise.all(candidates.map(async (candidate) => {
    const id = candidate.issueId.toUpperCase();
    const rows = await attempt(() => (deps.listIssueConversations ?? defaultListIssueConversations)(id), []);
    conversationsById.set(id, rows.map((conv) => boardConversation(conv, panesByKey)));
  }));
  const gateCandidates: GateIssueCandidate[] = candidates.map((candidate) => {
    const id = candidate.issueId.toUpperCase();
    const cwds = (conversationsById.get(id) ?? [])
      .filter((conv) => conv.status === 'active')
      .map((conv) => conv.cwd)
      // The primary checkout is every issue's parent; it names none of them.
      .filter((cwd) => cwd !== projectRoot);
    return { issueId: id, paths: [...(candidate.workspacePath ? [candidate.workspacePath] : []), ...cwds] };
  });
  const gateWaitersById = groupGateEntries(board.gateQueue?.waiters ?? [], gateCandidates);
  const gateOwnersById = groupGateEntries(board.gateQueue?.owners ?? [], gateCandidates);
  const gateMemory = board.memory && board.softReserveBytes !== null
    ? { memAvailableBytes: board.memory.memAvailableBytes, softReserveBytes: board.softReserveBytes }
    : null;
  const journalTail = deps.journalTail
    ?? (deps.lastJournal
      ? async (ws: string) => { const entry = await deps.lastJournal!(ws); return entry ? [entry] : []; }
      : defaultJournalTail);
  const rows: FlywheelInFlightRow[] = await Promise.all(candidates.map(async (candidate) => {
    const id = candidate.issueId.toUpperCase();
    const derived = states.get(id);
    const issue = issues[id] ?? null;
    // A tick-only id has no workspace, so it has no journal of its own.
    // PAN-5623: stack.* housekeeping entries are never the row's journal tail.
    const journal = (candidate.workspacePath ? await attempt(() => journalTail(candidate.workspacePath!), []) : [])
      .filter((entry) => !isHousekeepingEntry(entry));
    const entry = journal[journal.length - 1] ?? null;
    // A strike row with no feature-branch PR carries its open strike PR as
    // `row.pr`; tracker state wins, so a closed issue stays closed even with
    // an open strike PR (D7, PAN-4752).
    const strikePr = candidate.strike && !derived?.pr
      ? await (deps.readStrikePr ?? defaultReadStrikePr)(projectRoot, id)
      : null;
    const state = strikePr && derived?.state !== 'closed'
      ? strikePr.reviewState === 'changes-requested' ? 'changes-requested' : 'in-review'
      : derived?.state ?? 'backlog';
    const attention = strikePr && derived?.attention === 'work-not-started' ? undefined : derived?.attention;
    const pr = derived?.pr ?? strikePr ?? undefined;
    const conversations = conversationsById.get(id) ?? [];
    const [startedBy, aggregateCost, autoMergeRow] = await Promise.all([
      attempt(() => (deps.readStartedBy ?? defaultReadStartedBy)(id), null),
      attempt(() => (deps.issueCost ?? defaultIssueCost)(id), null),
      attempt(() => (deps.readAutoMerge ?? defaultReadAutoMerge)(id), null),
    ]);
    const facts: BoardFacts = {
      issueId: id,
      state,
      ...(attention ? { attention } : {}),
      ...(pr ? { pr } : {}),
      ...(derived?.workStart ? { workStart: derived.workStart } : {}),
      ...(derived?.prOutsidePipeline ? { prOutsidePipeline: derived.prOutsidePipeline } : {}),
      journal,
      panes: livePanesByIssue.get(id) ?? [],
      conversations,
      gateWaiters: gateWaitersById.get(id) ?? [],
      gateOwners: gateOwnersById.get(id) ?? [],
      gateQueue: board.gateQueue,
      gateMemory,
      autoMerge: boardAutoMerge(autoMergeRow),
      generation: board.generationById.get(id) ?? null,
      batchingPausedUntil: board.batchingPausedUntil,
      inTick: candidate.inTick,
      startedBy,
      nowMs: now,
    };
    return {
      issueId: candidate.issueId,
      title: issue?.title ?? null,
      state,
      ...(attention ? { attention } : {}),
      ...(pr ? { pr } : {}),
      ...(issue ? {} : { trackerUnknown: true as const }),
      ...(candidate.strike ? { strike: true as const } : {}),
      liveAgents: livePanesByIssue.get(id)?.length ?? 0,
      inTick: candidate.inTick,
      lastJournal: entry ? { at: entry.at, type: entry.type, ...(entry.source ? { source: entry.source } : {}) } : null,
      ...boardFields(facts, aggregateCost, conversations),
    };
  }));
  // A merged or closed issue's workspace lingers until close-out; it is not in flight.
  const inFlight = rows.filter((row) => row.state !== 'merged' && row.state !== 'closed');

  const inFlightIds = new Set(inFlight.map((row) => row.issueId.toUpperCase()));
  const agents: FlywheelAgentSummary[] = inFlight
    .flatMap((row) => livePanesByIssue.get(row.issueId.toUpperCase()) ?? [])
    .filter((pane) => inFlightIds.has((pane.issue ?? '').toUpperCase()))
    .map((pane) => ({
      issueId: (pane.issue ?? '').toUpperCase(),
      role: pane.role,
      harness: pane.harness,
      model: pane.model,
      state: pane.state,
      ...(pane.agentId ? { agentId: pane.agentId } : {}),
    }))
    .sort((a, b) => a.issueId.localeCompare(b.issueId) || a.role.localeCompare(b.role));

  const [policies, orderBook] = await Promise.all([
    (deps.policies ?? defaultPolicies)(),
    (deps.runningBook ?? defaultRunningBook)(panDir),
  ]);

  return {
    run,
    conversation,
    lastTick,
    previousRun,
    freshness: lastTick ? freshnessFor(lastTick.at, now) : null,
    policies,
    inFlight,
    agents,
    // A running loop's own tick list is the authority on what it is driving;
    // with no conversation or no tick, the workspace census is all there is.
    inFlightSource: conv && lastTick ? 'tick' : 'census',
    orderBook,
    projectRoot,
    generatedAt: new Date(now).toISOString(),
  };
}
