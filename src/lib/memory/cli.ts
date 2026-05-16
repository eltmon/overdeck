import { randomUUID } from 'crypto';
import { readdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { MemoryObservation, MemoryStatus, ResetMarker } from '@panctl/contracts';
import { getPanopticonHome } from '../paths.js';
import { withMemoryFtsDatabase } from './fts-db.js';
import { resolveExtractionProviderSelection } from './providers/index.js';
import { getMemoryRollupPendingThreshold, loadMemorySettings } from './settings.js';
import {
  ensureDir,
  ensureParentDir,
  resolveIssueMemoryRoot,
  resolveMemoryRoot,
  resolveObservationsFile,
  resolvePendingDir,
  resolveRagRunsFile,
  resolveStatusFile,
  resolveSummariesDir,
} from './paths.js';
import { getMemoryHealthPath, type MemoryHealthSnapshot } from './health.js';
import { readCurrentStatus } from './rollup.js';

const DEFAULT_PROJECT_ID = 'panopticon-cli';
const MIN_DAILY_SUMMARY_OBSERVATIONS = 3;
const DAILY_SUMMARY_REGENERATION_OBSERVATIONS = 20;

export interface MemorySearchOptions {
  project?: string;
  workspace?: string;
  issue?: string;
  tag?: string;
  sibling?: boolean;
  limit?: number;
  includeArchived?: boolean;
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

export async function searchMemory(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchResult[]> {
  const projectId = options.project ?? DEFAULT_PROJECT_ID;
  const observations = await readObservationScope(projectId, options.issue, options.sibling ?? false);
  const resetMarkers = options.includeArchived ? [] : await readResetMarkers(projectId);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = observations
    .filter((observation) => !options.workspace || observation.workspaceId === options.workspace)
    .filter((observation) => !options.issue || options.sibling || observation.issueId === options.issue)
    .filter((observation) => options.includeArchived || isAfterLatestResetMarker(observation, resetMarkers))
    .filter((observation) => !options.tag || observation.tags.includes(options.tag))
    .map((observation) => ({ observation, score: scoreObservation(observation, terms) }))
    .filter((result) => terms.length === 0 || result.score > 0)
    .sort((a, b) => b.score - a.score || b.observation.timestamp.localeCompare(a.observation.timestamp));

  return results.slice(0, options.limit ?? 20);
}

export async function getMemoryStatus(projectId: string, issueId: string): Promise<MemoryStatus | undefined> {
  return readCurrentStatus(projectId, issueId);
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
  issueId: string;
  date?: string;
}): Promise<DailySummaryResult> {
  const projectId = input.projectId ?? DEFAULT_PROJECT_ID;
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const path = join(resolveSummariesDir(projectId, input.issueId), `${date}.md`);
  const observations = await readObservationsFile(resolveObservationsFile(projectId, input.issueId, date));
  const existingMarkdown = await readTextFile(path);
  const previousObservationCount = existingMarkdown ? parseSummaryObservationCount(existingMarkdown) : null;

  if (observations.length < MIN_DAILY_SUMMARY_OBSERVATIONS) {
    return { status: 'insufficient-data', path, markdown: existingMarkdown ?? '', observationCount: observations.length, previousObservationCount };
  }

  if (existingMarkdown && previousObservationCount !== null && observations.length - previousObservationCount < DAILY_SUMMARY_REGENERATION_OBSERVATIONS) {
    return { status: 'up-to-date', path, markdown: existingMarkdown, observationCount: observations.length, previousObservationCount };
  }

  const markdown = buildDailySummaryMarkdown(input.issueId, date, observations);
  await ensureParentDir(path);
  await writeFile(path, markdown, 'utf8');
  await indexDailySummary(projectId, input.issueId, date, observations, markdown);
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

async function readObservationScope(projectId: string, issueId: string | undefined, sibling: boolean): Promise<MemoryObservation[]> {
  if (issueId && !sibling) return readIssueObservations(projectId, issueId);
  const issueIds = await listIssueIds(projectId);
  const selectedIssueIds = issueId && sibling ? issueIds.filter((candidate) => candidate !== issueId) : issueIds;
  const nested = await Promise.all(selectedIssueIds.map((candidate) => readIssueObservations(projectId, candidate)));
  return nested.flat();
}

async function readIssueObservations(projectId: string, issueId: string): Promise<MemoryObservation[]> {
  const observationsDir = dirname(resolveObservationsFile(projectId, issueId, new Date()));
  const files = (await readdir(observationsDir).catch((error: unknown) => {
    if (isEnoent(error)) return [] as string[];
    throw error;
  })).filter((file) => file.endsWith('.jsonl')).sort();
  const nested = await Promise.all(files.map((file) => readObservationsFile(join(observationsDir, file))));
  return nested.flat();
}

async function readResetMarkers(projectId: string): Promise<ResetMarker[]> {
  const jsonMarkers = await readJsonFile<ResetMarker[]>(join(resolveMemoryRoot(projectId), 'reset-markers.json'), []);
  const dbMarkers = await withMemoryFtsDatabase(projectId, (db) => db.prepare(`
    SELECT id, scope, scope_id, from_timestamp, reason, created_at
    FROM reset_markers
  `).all() as Array<{
    id: number;
    scope: ResetMarker['scope'];
    scope_id: string;
    from_timestamp: string;
    reason: string | null;
    created_at: string;
  }>).catch((error: unknown) => {
    if (isNoSuchTable(error)) return [];
    throw error;
  });
  return dedupeResetMarkers([
    ...jsonMarkers,
    ...dbMarkers.map((marker) => ({
      id: `db-${marker.id}`,
      scope: marker.scope,
      scopeId: marker.scope_id,
      fromTimestamp: marker.from_timestamp,
      reason: marker.reason ?? '',
      createdAt: marker.created_at,
    })),
  ]);
}

function dedupeResetMarkers(markers: ResetMarker[]): ResetMarker[] {
  const seen = new Set<string>();
  const deduped: ResetMarker[] = [];
  for (const marker of markers) {
    const key = [marker.scope, marker.scopeId, marker.fromTimestamp, marker.reason, marker.createdAt].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(marker);
  }
  return deduped;
}

function isAfterLatestResetMarker(observation: MemoryObservation, markers: ResetMarker[]): boolean {
  const latest = markers
    .filter((marker) => appliesToObservation(marker, observation))
    .map((marker) => marker.fromTimestamp)
    .sort()
    .at(-1);
  return !latest || observation.timestamp > latest;
}

function appliesToObservation(marker: ResetMarker, observation: MemoryObservation): boolean {
  switch (marker.scope) {
    case 'project':
      return marker.scopeId === observation.projectId;
    case 'workspace':
      return marker.scopeId === observation.workspaceId;
    case 'issue':
      return marker.scopeId === observation.issueId;
    case 'session':
      return marker.scopeId === observation.sessionId;
  }
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

async function indexDailySummary(projectId: string, issueId: string, date: string, observations: MemoryObservation[], markdown: string): Promise<void> {
  const latest = observations.at(-1);
  const files = [...new Set(observations.flatMap((observation) => observation.files))].join(',');
  const tags = [...new Set(['memory', 'summary', ...observations.flatMap((observation) => observation.tags)])].join(',');
  const entryTime = latest?.timestamp.slice(11) ?? '00:00:00.000Z';
  await withMemoryFtsDatabase(projectId, (db) => {
    db.prepare(`
      DELETE FROM memory_fts
      WHERE project_id = ?
        AND issue_id = ?
        AND doc_type = 'summary'
        AND entry_date = ?
    `).run(projectId, issueId, date);
    db.prepare(`
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
    `).run(
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
      'issue',
      projectId,
      latest?.workspaceId ?? '',
      issueId,
      latest?.runId ?? '',
      latest?.sessionId ?? '',
      latest?.agentRole ?? '',
      latest?.agentHarness ?? '',
    );
  });
}

async function listIssueIds(projectId: string): Promise<string[]> {
  const root = resolveMemoryRoot(projectId);
  const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if (isEnoent(error)) return [];
    throw error;
  });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function scoreObservation(observation: MemoryObservation, terms: string[]): number {
  const haystack = [
    observation.actionStatus ?? '',
    observation.summary,
    observation.narrative,
    observation.files.join(' '),
    observation.tags.join(' '),
  ].join(' ').toLowerCase();
  return terms.reduce((score, term) => score + occurrences(haystack, term), 0);
}

function occurrences(value: string, term: string): number {
  let count = 0;
  let index = value.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = value.indexOf(term, index + term.length);
  }
  return count;
}

async function readIssueDoctorSnapshots(projectId: string): Promise<MemoryDoctorResult['issues']> {
  const issueIds = await listIssueIds(projectId);
  return Promise.all(issueIds.map(async (issueId) => {
    const health = await readJsonFile<MemoryHealthSnapshot>(getMemoryHealthPath({ projectId, issueId }), emptyHealth());
    const pendingCount = await countJsonFiles(resolvePendingDir(projectId, issueId));
    const observations = await readIssueObservations(projectId, issueId);
    return {
      projectId,
      issueId,
      health,
      pendingCount,
      lastObservation: observations.at(-1)?.timestamp ?? null,
    };
  }));
}

async function readActiveAgents(): Promise<Array<{ id: string; issueId: string }>> {
  const agentsDir = join(getPanopticonHome(), 'agents');
  const entries = await readdir(agentsDir, { withFileTypes: true }).catch((error: unknown) => {
    if (isEnoent(error)) return [];
    throw error;
  });
  const agents: Array<{ id: string; issueId: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const state = await readJsonFile<Record<string, unknown>>(join(agentsDir, entry.name, 'state.json'), {});
    if ((state.status === 'running' || state.status === 'starting') && typeof state.issueId === 'string') {
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
  await withMemoryFtsDatabase(projectId, (db) => {
    db.prepare(`
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

function isNoSuchTable(error: unknown): boolean {
  return error instanceof Error && error.message.includes('no such table: reset_markers');
}
