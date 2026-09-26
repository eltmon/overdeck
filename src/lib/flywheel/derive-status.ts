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

import type {
  BackendPane,
  DerivedIssueState,
  FlywheelAgentSummary,
  FlywheelConversationSummary,
  FlywheelDerivedStatus,
  FlywheelFreshness,
  FlywheelInFlightRow,
  FlywheelOrderBookSummary,
  FlywheelPolicies,
} from '@overdeck/contracts';

import type { LegacyConversation } from '../overdeck/conversations.js';
import type { TrackerIssueFacts } from '../overdeck/derived-issue-state.js';
import type { PipelineJournalEntry } from '../cloister/pipeline-journal.js';
import {
  FLYWHEEL_CONVERSATION_SESSION,
  FLYWHEEL_FRESHNESS_BREATHING_MS,
  FLYWHEEL_FRESHNESS_LIVE_MS,
} from './constants.js';
import { findLastTick, type TickMarkerMessage } from './tick-marker.js';

export interface FlywheelWorkspace {
  issueId: string;
  workspacePath: string;
}

export interface DeriveFlywheelStatusDeps {
  getConversation?: (name: string) => LegacyConversation | null | Promise<LegacyConversation | null>;
  sessionAlive?: (tmuxSession: string) => Promise<boolean>;
  readTranscript?: (conv: LegacyConversation) => Promise<readonly TickMarkerMessage[]>;
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

/** A pane that is still a running agent: not exited, and not finished. */
function paneIsLive(pane: BackendPane): boolean {
  return pane.state !== 'exited' && pane.state !== 'done';
}

async function defaultLastJournal(workspacePath: string): Promise<PipelineJournalEntry | null> {
  const { lastPipelineEntry } = await import('../cloister/pipeline-journal.js');
  return lastPipelineEntry(workspacePath);
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
  const { listBooks, computeBookProgress } = await import('../orders/resolver.js');
  let books;
  try {
    books = listBooks(panDir);
  } catch {
    return null;
  }
  const book = books.find((b) => b.status === 'running');
  if (!book) return null;
  const progress = computeBookProgress(book);
  return { id: book.id, name: book.name, status: book.status, landed: progress.landed, total: progress.total };
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

  const messages = conv ? await (deps.readTranscript ?? readFlywheelTranscript)(conv) : [];
  const lastTick = findLastTick(messages);

  const { projectRoot, planHome } = await resolveRoots(conv?.cwd ?? options.projectRoot ?? process.cwd(), deps);
  const panDir = join(planHome, '.pan');

  const workspaces = await (deps.listWorkspaces ?? defaultListWorkspaces)(projectRoot);
  // The board is the union of the workspace census and the ids the loop named
  // in its own newest tick: an issue the loop is driving without a workspace
  // of its own is still in flight, and a workspace the loop has not picked up
  // is still real. Census order first, then the tick-only ids.
  const candidates: Array<{ issueId: string; workspacePath: string | null; inTick: boolean }> = [];
  const seen = new Set<string>();
  const tickIds = new Set((lastTick?.inFlight ?? []).map((id) => id.toUpperCase()));
  for (const ws of workspaces) {
    const id = ws.issueId.toUpperCase();
    if (seen.has(id)) continue;
    seen.add(id);
    candidates.push({ issueId: ws.issueId, workspacePath: ws.workspacePath, inTick: tickIds.has(id) });
  }
  for (const id of tickIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    candidates.push({ issueId: id, workspacePath: null, inTick: true });
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
  for (const pane of panes) {
    if (!pane.issue || !paneIsLive(pane)) continue;
    const id = pane.issue.toUpperCase();
    const list = livePanesByIssue.get(id);
    if (list) list.push(pane); else livePanesByIssue.set(id, [pane]);
  }
  const lastJournal = deps.lastJournal ?? defaultLastJournal;
  const rows: FlywheelInFlightRow[] = await Promise.all(candidates.map(async (candidate) => {
    const id = candidate.issueId.toUpperCase();
    const derived = states.get(id);
    const issue = issues[id] ?? null;
    // A tick-only id has no workspace, so it has no journal of its own.
    const entry = candidate.workspacePath ? await lastJournal(candidate.workspacePath) : null;
    return {
      issueId: candidate.issueId,
      title: issue?.title ?? null,
      state: derived?.state ?? 'backlog',
      ...(derived?.attention ? { attention: derived.attention } : {}),
      ...(derived?.pr ? { pr: derived.pr } : {}),
      ...(issue ? {} : { trackerUnknown: true as const }),
      liveAgents: livePanesByIssue.get(id)?.length ?? 0,
      inTick: candidate.inTick,
      lastJournal: entry ? { at: entry.at, type: entry.type, ...(entry.source ? { source: entry.source } : {}) } : null,
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
