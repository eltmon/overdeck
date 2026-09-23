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
  DerivedIssueState,
  FlywheelConversationSummary,
  FlywheelDerivedStatus,
  FlywheelFreshness,
  FlywheelInFlightRow,
  FlywheelOrderBookSummary,
  FlywheelPolicies,
} from '@overdeck/contracts';

import type { LegacyConversation } from '../overdeck/conversations.js';
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
  loadStates?: (projectPath: string, issueIds: readonly string[]) => Promise<Map<string, DerivedIssueState>>;
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
  const [{ Effect }, { sessionExists }] = await Promise.all([import('effect'), import('../tmux.js')]);
  return Effect.runPromise(sessionExists(tmuxSession));
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
  const { findProjectByPathSync } = await import('../projects.js');
  return findProjectByPathSync(dir)?.path ?? null;
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

async function defaultLoadStates(projectPath: string, issueIds: readonly string[]): Promise<Map<string, DerivedIssueState>> {
  const { loadIssueStatesForProject } = await import('../overdeck/derived-issue-state.js');
  return loadIssueStatesForProject(projectPath, issueIds);
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
        sessionAlive,
      }
    : null;

  const messages = conv ? await (deps.readTranscript ?? readFlywheelTranscript)(conv) : [];
  const lastTick = findLastTick(messages);

  const { projectRoot, planHome } = await resolveRoots(conv?.cwd ?? options.projectRoot ?? process.cwd(), deps);
  const panDir = join(planHome, '.pan');

  const workspaces = await (deps.listWorkspaces ?? defaultListWorkspaces)(projectRoot);
  const states = workspaces.length
    ? await (deps.loadStates ?? defaultLoadStates)(projectRoot, workspaces.map((ws) => ws.issueId))
    : new Map<string, DerivedIssueState>();
  const lastJournal = deps.lastJournal ?? defaultLastJournal;
  const rows: FlywheelInFlightRow[] = await Promise.all(workspaces.map(async (ws) => {
    const derived = states.get(ws.issueId.toUpperCase());
    const entry = await lastJournal(ws.workspacePath);
    return {
      issueId: ws.issueId,
      state: derived?.state ?? 'backlog',
      ...(derived?.attention ? { attention: derived.attention } : {}),
      ...(derived?.pr ? { pr: derived.pr } : {}),
      lastJournal: entry ? { at: entry.at, type: entry.type, ...(entry.source ? { source: entry.source } : {}) } : null,
    };
  }));
  // A merged or closed issue's workspace lingers until close-out; it is not in flight.
  const inFlight = rows.filter((row) => row.state !== 'merged' && row.state !== 'closed');

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
    orderBook,
    projectRoot,
    generatedAt: new Date(now).toISOString(),
  };
}
