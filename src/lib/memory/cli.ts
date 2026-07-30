import { randomUUID } from 'crypto';
import { readdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join } from 'path';
import type { MemoryObservation, MemoryStatus, ResetMarker } from '@overdeck/contracts';
import { getOverdeckHome } from '../paths.js';
import { runMemoryFtsTransaction, withMemoryFtsDatabase } from './fts-db.js';
import { resolveExtractionProviderSelection } from './providers/index.js';
import { getMemoryRollupPendingThreshold, loadMemorySettings } from './settings.js';
import {
  ensureParentDir,
  resolveMemoryRoot,
  resolveObservationsFile,
  resolvePendingDir,
  resolveSummariesDir,
  resolveWorkspaceMemoryRoot,
} from './paths.js';
import { readVerifiedPinFile, resolveContainedPinPath } from './pin-path.js';
import { getMemoryHealthPath, type MemoryHealthSnapshot } from './health.js';
import { mirrorDailySummary } from './state-mirror.js';
import { readArchivedStatusEntries, readCurrentStatus, readObservationsSince, type ArchivedStatusEntry } from './rollup.js';
import { getAgentStateSync } from '../agents.js';
import {
  getWorkspaceForIssue,
  listProjects,
  listWorkspaces,
  listWorkspacesForPath,
  resolveWorkspaceForCwd,
  resolveWorkspaceRef,
} from '../workspaces/resolver.js';
import { searchMemory as searchMemoryFts, type MemorySearchHit } from './search.js';

const DEFAULT_PROJECT_ID = 'overdeck';
const MIN_DAILY_SUMMARY_OBSERVATIONS = 3;
const DAILY_SUMMARY_REGENERATION_OBSERVATIONS = 20;
/** Upper bound on `pan memory status --history <n>` (PAN-3286 D-8). */
export const MEMORY_STATUS_HISTORY_LIMIT = 50;

const ADDRESSING_MODES_HINT =
  'Address a workspace with --workspace <id|name>, with an issue positional, or by running the command from inside the workspace directory.';

export interface MemorySearchOptions {
  project?: string;
  workspace?: string;
  issue?: string;
  tag?: string;
  sibling?: boolean;
  global?: boolean;
  limit?: number;
  includeArchived?: boolean;
  /** All workspaces targeting this directory (PAN-3286 FR-4) — resolved by the caller via listWorkspacesForPath. */
  targetPath?: string;
}

export interface MemorySearchResult {
  observation: MemoryObservation;
  score: number;
}

export type DailySummaryStatus = 'generated' | 'insufficient-data' | 'up-to-date';

export interface DailySummaryResult {
  status: DailySummaryStatus;
  path: string;
  markdown: string;
  observationCount: number;
  previousObservationCount: number | null;
}

export interface MemoryDoctorOptions {
  project?: string;
  now?: Date;
}

export interface MemoryDoctorResult {
  exitCode: number;
  provider: Awaited<ReturnType<typeof resolveExtractionProviderSelection>>;
  rollupPendingThreshold: number;
  issues: Array<{
    projectId: string;
    issueId: string;
    health: MemoryHealthSnapshot;
    pendingCount: number;
    lastObservation: string | null;
  }>;
  staleActiveAgents: Array<{ agentId: string; issueId: string; lastSuccess: string | null }>;
}

/**
 * PAN-1990 FR-9: search runs against the existing memory_fts index (every
 * observation write indexes into it — see observations.ts's indexObservation)
 * instead of reading every daily JSONL file for every workspace into memory
 * and sorting the full corpus. Runtime and memory scale with the FTS-bounded
 * result set (limit), not with total history. Reset-marker filtering also
 * moves into the FTS query itself (search.ts already does this in SQL).
 *
 * `--workspace <id|name>` (D-3) resolves either a workspace UUID or a
 * workspace name, then uses ITS OWNING project before searching, so a
 * workspace registered under a project other than `overdeck` is actually
 * searched instead of silently querying the default project and finding
 * nothing. A name that matches more than one workspace across projects is
 * reported as an ambiguity error rather than guessing.
 */
/** Search one project (optionally scoped to one workspace/issue within it) and resolve hits back to observations. */
async function searchProjectScope(input: {
  query: string;
  projectId: string;
  workspaceId?: string;
  issueId?: string;
  sibling?: boolean;
  includeArchived?: boolean;
  tags?: string[];
  limit: number;
}): Promise<MemorySearchResult[]> {
  const hits = await searchMemoryFts({
    query: input.query,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    issueId: input.issueId,
    sibling: input.sibling,
    includeArchived: input.includeArchived,
    tags: input.tags,
    // The shared FTS index also carries daily-summary hits (doc_type
    // 'summary'), which this command can't resolve back to a
    // MemoryObservation — restrict to observations so a summary ranked
    // above matching observations doesn't consume the limit and vanish.
    docType: 'observation',
    limit: input.limit,
  });

  const fileCache = new Map<string, MemoryObservation[]>();
  const pairs = await Promise.all(hits.map(async (hit) => ({
    hit,
    observation: await resolveObservationFromHit(input.projectId, hit, fileCache),
  })));
  return pairs
    .filter((pair): pair is { hit: MemorySearchHit; observation: MemoryObservation } => pair.observation !== null)
    .map((pair) => ({ observation: pair.observation, score: pair.hit.rankScore }));
}

/** Merge per-scope result sets by rank score (ties broken by recency), capped at limit. */
function mergeRankedResults(perScope: MemorySearchResult[][], limit: number): MemorySearchResult[] {
  return perScope.flat()
    .sort((a, b) => b.score - a.score || b.observation.timestamp.localeCompare(a.observation.timestamp))
    .slice(0, limit);
}

export async function searchMemory(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchResult[]> {
  const limit = options.limit ?? 20;

  // --target fans out per matched workspace (which may span several
  // projects, each with its own FTS shard) instead of per project — the
  // caller has already resolved targetPath via listWorkspacesForPath, so a
  // zero-match "no workspaces target <dir>" note can be printed without
  // ever reaching the FTS index.
  if (options.targetPath) {
    const workspaces = listWorkspacesForPath(options.targetPath);
    const perWorkspace = await Promise.all(workspaces.map((workspace) => searchProjectScope({
      query,
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      sibling: options.sibling,
      includeArchived: options.includeArchived,
      tags: options.tag ? [options.tag] : undefined,
      limit,
    })));
    return mergeRankedResults(perWorkspace, limit);
  }

  let resolvedWorkspaceId: string | undefined;
  let resolvedWorkspaceProjectId: string | undefined;
  if (options.workspace) {
    const resolution = resolveWorkspaceRef(options.workspace);
    if (resolution.ambiguous) {
      throw new Error(`Multiple workspaces named '${options.workspace}' found (projects: ${resolution.matches.map((w) => w.projectId).join(', ')}); use the workspace id instead.`);
    }
    if (resolution.workspace) {
      resolvedWorkspaceId = resolution.workspace.id;
      resolvedWorkspaceProjectId = resolution.workspace.projectId;
    } else {
      // Matches neither an id nor a name — keep filtering by the literal ref
      // (which then matches no FTS rows) rather than throwing or silently
      // searching the whole project unfiltered.
      resolvedWorkspaceId = options.workspace;
    }
  }

  const projectIds = options.global
    ? listProjects().map((project) => project.id)
    : [resolvedWorkspaceProjectId ?? options.project ?? DEFAULT_PROJECT_ID];
  // sibling mode needs a workspaceId to exclude even when the caller only
  // passed --issue (the CLI's usual sibling invocation) — resolve it the same
  // way the pre-FTS implementation did.
  const workspaceIdForIssue = options.issue ? getWorkspaceForIssue(options.issue)?.id : undefined;

  const perProject = await Promise.all(projectIds.map((projectId) => searchProjectScope({
    query,
    projectId,
    workspaceId: resolvedWorkspaceId ?? workspaceIdForIssue,
    issueId: options.issue,
    sibling: options.sibling,
    includeArchived: options.includeArchived,
    tags: options.tag ? [options.tag] : undefined,
    limit,
  })));

  return mergeRankedResults(perProject, limit);
}

/** Resolve an FTS hit back to its full MemoryObservation by reading only the one day-file it points at. */
async function resolveObservationFromHit(
  projectId: string,
  hit: MemorySearchHit,
  fileCache: Map<string, MemoryObservation[]>,
): Promise<MemoryObservation | null> {
  const filePath = resolveObservationsFile(projectId, hit.workspaceId, hit.entryDate);
  let observations = fileCache.get(filePath);
  if (!observations) {
    observations = await readObservationsFile(filePath);
    fileCache.set(filePath, observations);
  }
  return observations.find((observation) => observation.id === hit.source) ?? null;
}

/**
 * Issue-shaped facade over `getMemoryStatusForWorkspace`, retained as the
 * pre-PAN-3286 public entry point (the CLI now resolves a workspace first).
 */
export async function getMemoryStatus(projectId: string, issueId: string): Promise<MemoryStatus | undefined> {
  const workspaceId = getWorkspaceForIssue(issueId)?.id;
  if (!workspaceId) return undefined;
  return getMemoryStatusForWorkspace(projectId, workspaceId);
}

export interface MemoryWorkspaceTargetInput {
  /**
   * `--project`, used only by the issue-positional arm so its memory-root
   * resolution stays byte-identical to `getMemoryStatus` (PAN-3286 FR-5).
   */
  projectId?: string;
  issueId?: string;
  workspaceRef?: string;
  cwd?: string;
}

export interface MemoryWorkspaceTarget {
  projectId: string;
  workspaceId: string;
  workspaceName: string;
  issueId: string | null;
  /** What to print in messages and summary titles: the issue id, else the workspace name. */
  label: string;
}

/**
 * The three memory addressing modes, in precedence order: `--workspace <ref>`,
 * an issue positional, then the workspace owning the cwd (PAN-3286 FR-5).
 * Throws with an actionable message naming all three when nothing resolves.
 */
export function resolveMemoryWorkspaceTarget(input: MemoryWorkspaceTargetInput): MemoryWorkspaceTarget {
  if (input.workspaceRef) {
    const resolution = resolveWorkspaceRef(input.workspaceRef);
    if (resolution.ambiguous) {
      throw new Error(
        `Multiple workspaces named '${input.workspaceRef}' found (projects: ${resolution.matches.map((w) => w.projectId).join(', ')}); use the workspace id instead.`,
      );
    }
    if (!resolution.workspace) {
      throw new Error(`No workspace found with id or name '${input.workspaceRef}'`);
    }
    const workspace = resolution.workspace;
    return {
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      issueId: workspace.issueId,
      label: workspace.issueId ?? workspace.name,
    };
  }

  if (input.issueId) {
    const workspace = getWorkspaceForIssue(input.issueId);
    // Message deliberately unchanged from the pre-PAN-3286 issue-only path.
    if (!workspace) throw new Error(`No workspace found for issue ${input.issueId}`);
    return {
      projectId: input.projectId ?? DEFAULT_PROJECT_ID,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      issueId: input.issueId,
      label: input.issueId,
    };
  }

  const cwd = input.cwd ?? process.cwd();
  const workspace = resolveWorkspaceForCwd(cwd);
  if (!workspace) {
    throw new Error(`No workspace is registered for ${cwd}. ${ADDRESSING_MODES_HINT}`);
  }
  return {
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    issueId: workspace.issueId,
    label: workspace.issueId ?? workspace.name,
  };
}

export interface MemoryTimelineOptions {
  /** Most recent N calendar days, counting today as day 1. */
  days?: number;
  limit?: number;
  now?: Date;
}

/** Default day window and row cap for `pan memory timeline` (PAN-3286 FR-8). */
export const MEMORY_TIMELINE_DEFAULT_DAYS = 7;
export const MEMORY_TIMELINE_DEFAULT_LIMIT = 50;

/**
 * Chronological observations for a resolved workspace, oldest-first
 * (PAN-3286 FR-8). The window and cap default to the last 7 days and 50 rows.
 */
export async function getMemoryTimeline(
  projectId: string,
  workspaceId: string,
  options: MemoryTimelineOptions = {},
): Promise<MemoryObservation[]> {
  return readObservationsSince(projectId, workspaceId, {
    days: options.days ?? MEMORY_TIMELINE_DEFAULT_DAYS,
    limit: options.limit ?? MEMORY_TIMELINE_DEFAULT_LIMIT,
    now: options.now,
  });
}

export type MemoryReadResult =
  | { status: 'ok'; relativePath: string; content: string }
  | { status: 'absolute-path' }
  | { status: 'escapes-home' }
  | { status: 'unreadable' };

export interface MemoryReadOptions {
  /** 1-based first line to print. */
  from?: number;
  /** Maximum number of lines to print, counting from `from`. */
  lines?: number;
}

/**
 * Read a file from a workspace's memory home, refusing anything that is not a
 * regular file genuinely inside it (PAN-3286 FR-9, D-9, NFR-4).
 *
 * Containment is delegated to `readVerifiedPinFile`, which realpath-resolves
 * both the home and the target so an in-home symlink pointing outside is
 * rejected, and opens with `O_NOFOLLOW` so a final-component swap fails closed.
 * Absolute inputs are refused outright before that, so no absolute path can
 * ever be read even if it happens to land inside the home. Claude Code JSONL
 * session files under `~/.claude` are therefore unreachable by construction —
 * they live outside every memory home.
 */
export async function readMemoryFile(
  projectId: string,
  workspaceId: string,
  requestedPath: string,
  options: MemoryReadOptions = {},
): Promise<MemoryReadResult> {
  if (isAbsolute(requestedPath)) return { status: 'absolute-path' };

  const memoryHome = resolveWorkspaceMemoryRoot(projectId, workspaceId);
  const relativePath = resolveContainedPinPath(memoryHome, requestedPath);
  if (relativePath === null) return { status: 'escapes-home' };

  const content = await readVerifiedPinFile(memoryHome, relativePath);
  if (content === null) return { status: 'unreadable' };

  return { status: 'ok', relativePath, content: sliceLines(content, options) };
}

function sliceLines(content: string, options: MemoryReadOptions): string {
  const from = Math.max(1, Math.floor(options.from ?? 1));
  if (from === 1 && options.lines === undefined) return content;

  const endedWithNewline = content.endsWith('\n');
  const lines = content.split('\n');
  if (endedWithNewline) lines.pop();

  const start = from - 1;
  const selected = options.lines === undefined
    ? lines.slice(start)
    : lines.slice(start, start + Math.max(0, Math.floor(options.lines)));
  return selected.length === 0 ? '' : `${selected.join('\n')}\n`;
}

/** Current status for an already-resolved workspace (PAN-3286 FR-5). */
export async function getMemoryStatusForWorkspace(projectId: string, workspaceId: string): Promise<MemoryStatus | undefined> {
  return readCurrentStatus(projectId, workspaceId);
}

/**
 * Archived statuses newest-first, capped at `MEMORY_STATUS_HISTORY_LIMIT`
 * (PAN-3286 FR-6). The rollup writer prunes the on-disk archive to its three
 * most recent entries, so a larger request returns whatever is still retained.
 */
export async function getMemoryStatusHistory(
  projectId: string,
  workspaceId: string,
  limit: number,
): Promise<ArchivedStatusEntry[]> {
  const bounded = Math.min(Math.max(1, Math.floor(limit)), MEMORY_STATUS_HISTORY_LIMIT);
  return readArchivedStatusEntries(projectId, workspaceId, bounded);
}

export async function createResetMarker(input: {
  projectId?: string;
  scope: ResetMarker['scope'];
  scopeId: string;
  reason: string;
  fromTimestamp?: string;
  id?: string;
  createdAt?: string;
  emitResetMarkerCreated?: (marker: ResetMarker, timestamp: string) => void | Promise<void>;
}): Promise<ResetMarker> {
  const projectId = input.projectId ?? DEFAULT_PROJECT_ID;
  const marker: ResetMarker = {
    id: input.id ?? randomUUID(),
    scope: input.scope,
    scopeId: input.scopeId,
    fromTimestamp: input.fromTimestamp ?? new Date().toISOString(),
    reason: input.reason,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const path = join(resolveMemoryRoot(projectId), 'reset-markers.json');
  const markers = await readJsonFile<ResetMarker[]>(path, []);
  await writeJsonAtomically(path, [...markers, marker]);
  await writeResetMarkerToFtsDb(projectId, marker);
  await (input.emitResetMarkerCreated ?? emitResetMarkerCreated)(marker, marker.createdAt);
  return marker;
}

export async function generateDailySummary(input: {
  projectId?: string;
  issueId?: string;
  /** `--workspace <id|name>`; when omitted the issue positional or cwd resolves the target. */
  workspaceRef?: string;
  cwd?: string;
  date?: string;
}): Promise<DailySummaryResult> {
  const target = resolveMemoryWorkspaceTarget({
    projectId: input.projectId,
    issueId: input.issueId,
    workspaceRef: input.workspaceRef,
    cwd: input.cwd,
  });
  const projectId = target.projectId;
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const workspaceId = target.workspaceId;
  const path = join(resolveSummariesDir(projectId, workspaceId), `${date}.md`);
  const observations = await readObservationsFile(resolveObservationsFile(projectId, workspaceId, date));
  const existingMarkdown = await readTextFile(path);
  const previousObservationCount = existingMarkdown ? parseSummaryObservationCount(existingMarkdown) : null;

  if (observations.length < MIN_DAILY_SUMMARY_OBSERVATIONS) {
    return { status: 'insufficient-data', path, markdown: existingMarkdown ?? '', observationCount: observations.length, previousObservationCount };
  }

  if (existingMarkdown && previousObservationCount !== null && observations.length - previousObservationCount < DAILY_SUMMARY_REGENERATION_OBSERVATIONS) {
    return { status: 'up-to-date', path, markdown: existingMarkdown, observationCount: observations.length, previousObservationCount };
  }

  const markdown = buildDailySummaryMarkdown(target.label, date, observations);
  await ensureParentDir(path);
  await writeFile(path, markdown, 'utf8');
  await indexDailySummary(projectId, target, date, observations, markdown);
  await mirrorDailySummary(projectId, target.workspaceName, date, markdown);
  return { status: 'generated', path, markdown, observationCount: observations.length, previousObservationCount };
}

export async function runMemoryDoctor(options: MemoryDoctorOptions = {}): Promise<MemoryDoctorResult> {
  const projectId = options.project ?? DEFAULT_PROJECT_ID;
  const now = options.now ?? new Date();
  const provider = await resolveExtractionProviderSelection();
  const rollupPendingThreshold = await getMemoryRollupPendingThreshold();
  const issues = await readIssueDoctorSnapshots(projectId);
  const activeAgents = await readActiveAgents();
  const staleActiveAgents = activeAgents
    .map((agent) => {
      const issue = issues.find((candidate) => candidate.issueId === agent.issueId);
      return { agentId: agent.id, issueId: agent.issueId, lastSuccess: issue?.health.last_success ?? null };
    })
    .filter((agent) => isStaleExtraction(agent.lastSuccess, now));

  return {
    exitCode: staleActiveAgents.length > 0 ? 1 : 0,
    provider,
    rollupPendingThreshold,
    issues,
    staleActiveAgents,
  };
}

export async function readMemorySettingsSummary(): Promise<{
  rollupPendingThreshold: number;
  provider: Awaited<ReturnType<typeof resolveExtractionProviderSelection>>;
}> {
  return {
    rollupPendingThreshold: (await loadMemorySettings()).rollupPendingThreshold,
    provider: await resolveExtractionProviderSelection(),
  };
}

async function readWorkspaceObservations(projectId: string, workspaceId: string): Promise<MemoryObservation[]> {
  const observationsDir = dirname(resolveObservationsFile(projectId, workspaceId, new Date()));
  const files = (await readdir(observationsDir).catch((error: unknown) => {
    if (isEnoent(error)) return [] as string[];
    throw error;
  })).filter((file) => file.endsWith('.jsonl')).sort();
  const nested = await Promise.all(files.map((file) => readObservationsFile(join(observationsDir, file))));
  return nested.flat();
}

async function readObservationsFile(path: string): Promise<MemoryObservation[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
  return raw.split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as MemoryObservation);
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
}

function buildDailySummaryMarkdown(issueId: string, date: string, observations: MemoryObservation[]): string {
  const actions = observations.filter((observation) => observation.actionStatus !== null);
  return [
    `# ${issueId} memory summary — ${date}`,
    '',
    `Observations: ${observations.length}`,
    `Action updates: ${actions.length}`,
    '',
    ...observations.map((observation) => [
      `## ${observation.timestamp}`,
      '',
      observation.actionStatus ? `**Action:** ${observation.actionStatus}` : '**Action:** none',
      '',
      observation.summary,
      '',
      observation.files.length > 0 ? `Files: ${observation.files.join(', ')}` : 'Files: none',
      observation.tags.length > 0 ? `Tags: ${observation.tags.join(', ')}` : 'Tags: none',
      '',
    ].join('\n')),
  ].join('\n');
}

function parseSummaryObservationCount(markdown: string): number | null {
  const match = markdown.match(/^Observations: (\d+)$/m);
  return match ? Number(match[1]) : null;
}

async function indexDailySummary(projectId: string, target: MemoryWorkspaceTarget, date: string, observations: MemoryObservation[], markdown: string): Promise<void> {
  const latest = observations.at(-1);
  const files = [...new Set(observations.flatMap((observation) => observation.files))].join(',');
  const tags = [...new Set(['memory', 'summary', ...observations.flatMap((observation) => observation.tags)])].join(',');
  const entryTime = latest?.timestamp.slice(11) ?? '00:00:00.000Z';
  // Issue-addressed summaries keep the pre-PAN-3286 issue-keyed identity;
  // workspace-addressed ones (no issue) key on workspace_id instead so their
  // reset-marker scope and per-day dedupe both resolve. Both column names are
  // literals from a closed set, never user input.
  const dedupeColumn = target.issueId ? 'issue_id' : 'workspace_id';
  const dedupeValue = target.issueId ?? target.workspaceId;
  await runMemoryFtsTransaction(projectId, [
    {
      method: 'run',
      sql: `
        DELETE FROM memory_fts
        WHERE project_id = ?
          AND ${dedupeColumn} = ?
          AND doc_type = 'summary'
          AND entry_date = ?
      `,
      params: [projectId, dedupeValue, date],
    },
    {
      method: 'run',
      sql: `
        INSERT INTO memory_fts (
          content,
          display_content,
          source,
          branch,
          entry_date,
          entry_time,
          entry_type,
          files,
          tags,
          doc_type,
          scope,
          project_id,
          workspace_id,
          issue_id,
          run_id,
          session_id,
          agent_role,
          agent_harness
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        markdown,
        markdown,
        'summary',
        latest?.gitBranch ?? '',
        date,
        entryTime,
        'memory-summary',
        files,
        tags,
        'summary',
        target.issueId ? 'issue' : 'workspace',
        projectId,
        target.workspaceId,
        target.issueId ?? '',
        latest?.runId ?? '',
        latest?.sessionId ?? '',
        latest?.agentRole ?? '',
        latest?.agentHarness ?? '',
      ],
    },
  ]);
}

async function readIssueDoctorSnapshots(projectId: string): Promise<MemoryDoctorResult['issues']> {
  const issueWorkspaces = listWorkspaces({ projectId, kind: 'issue' }).filter((ws): ws is typeof ws & { issueId: string } => ws.issueId !== null);
  return Promise.all(issueWorkspaces.map(async (workspace) => {
    const health = await readJsonFile<MemoryHealthSnapshot>(getMemoryHealthPath({ projectId, workspaceId: workspace.id }), emptyHealth());
    const pendingCount = await countJsonFiles(resolvePendingDir(projectId, workspace.id));
    const observations = await readWorkspaceObservations(projectId, workspace.id);
    return {
      projectId,
      issueId: workspace.issueId,
      health,
      pendingCount,
      lastObservation: observations.at(-1)?.timestamp ?? null,
    };
  }));
}

async function readActiveAgents(): Promise<Array<{ id: string; issueId: string }>> {
  const agentsDir = join(getOverdeckHome(), 'agents');
  const entries = await readdir(agentsDir, { withFileTypes: true }).catch((error: unknown) => {
    if (isEnoent(error)) return [];
    throw error;
  });
  const agents: Array<{ id: string; issueId: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const state = getAgentStateSync(entry.name);
    if ((state?.status === 'running' || state?.status === 'starting') && state?.issueId) {
      agents.push({ id: entry.name, issueId: state.issueId });
    }
  }
  return agents;
}

async function countJsonFiles(path: string): Promise<number> {
  const entries = await readdir(path).catch((error: unknown) => {
    if (isEnoent(error)) return [] as string[];
    throw error;
  });
  return entries.filter((entry) => entry.endsWith('.json') && !entry.startsWith('.')).length;
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if (isEnoent(error)) return fallback;
    throw error;
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await ensureParentDir(path);
  const tempPath = `${dirname(path)}/.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
}

async function writeResetMarkerToFtsDb(projectId: string, marker: ResetMarker): Promise<void> {
  await withMemoryFtsDatabase(projectId, async (db) => {
    await db.prepare(`
      INSERT INTO reset_markers (scope, scope_id, from_timestamp, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(marker.scope, marker.scopeId, marker.fromTimestamp, marker.reason, marker.createdAt);
  });
}

async function emitResetMarkerCreated(marker: ResetMarker, timestamp: string): Promise<void> {
  const { initEventStore } = await import('../../dashboard/server/event-store.js');
  const store = await initEventStore();
  await store.appendAsync({
    type: 'memory.reset_marker_created',
    timestamp,
    payload: { marker },
  });
}

function isStaleExtraction(lastSuccess: string | null, now: Date): boolean {
  if (!lastSuccess) return true;
  const timestamp = Date.parse(lastSuccess);
  return Number.isNaN(timestamp) || now.getTime() - timestamp > 60 * 60 * 1000;
}

function emptyHealth(): MemoryHealthSnapshot {
  return {
    status: 'healthy',
    last_success: null,
    last_failure: null,
    extractions_attempted: 0,
    extractions_succeeded: 0,
    failed_by_reason: {},
  };
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
