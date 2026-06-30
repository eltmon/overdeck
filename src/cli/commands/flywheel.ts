import { exec, spawn } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { freemem, totalmem } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { Effect, Schema } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';
import { Command } from 'commander';
import {
  FlywheelStats,
  FlywheelStatus,
  type FlywheelStats as FlywheelStatsPayload,
  type FlywheelStatsCriteria,
  type FlywheelStatsCriterion,
  type FlywheelStatsCriterionStatus,
  type FlywheelStatsTrend,
} from '@overdeck/contracts';
import { abortFlywheelRun, clearFlywheelGate, getFlywheelRunDetail, getFlywheelRunDir, listFlywheelRuns, nextFlywheelRunId, readFlywheelLaunchMetadata, resolveLiveFlywheelRunId, writeFlywheelLaunchMetadata, writeLatestFlywheelStatus } from '../../dashboard/server/services/flywheel-run-state.js';
import { loadConfigSync, resolveModel, type FlywheelScope, type RoleEffort } from '../../lib/config-yaml.js';
import { FLYWHEEL_ORCHESTRATOR_AGENT_ID, pauseFlywheel, resumeFlywheel, spawnFlywheel } from '../../lib/cloister/flywheel.js';
import { stopAgent } from '../../lib/agents.js';
import type { RuntimeName } from '../../lib/runtimes/types.js';
import { resolveHarness } from '../../lib/harness-resolve.js';
import {
  FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY,
  FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY,
  getFlywheelActiveRunId,
  isFlywheelAutoPickupBacklog,
  isFlywheelGloballyPaused,
  isFlywheelRequireUatBeforeMerge,
  setFlywheelAutoPickupBacklog,
  setFlywheelRequireUatBeforeMerge,
} from '../../lib/overdeck/control-settings.js';
import { sessionExists } from '../../lib/tmux.js';
import { ensureInternalTokenSync, INTERNAL_TOKEN_HEADER } from '../../lib/internal-token.js';
import { computeMergeQueue, type MergeQueueItem } from '../../lib/flywheel-merge-order.js';
import { formatMergeBackendStatus, loadMergeBackendStatusForCli } from './flywheel-merge-backend.js';

type InputStream = AsyncIterable<string | Buffer | Uint8Array>;

interface EmitStatusOptions {
  file: string;
}

interface StatusOptions {
  json?: boolean;
}

interface StatsOptions {
  window?: string;
  json?: boolean;
}

interface FormatStatsOptions {
  color?: boolean;
}

interface ConfigOptions {
  get?: true | string;
  set?: string;
}

interface StartOptions {
  brief?: string;
  cwd?: string;
}

interface StartFlywheelRunResult {
  runId: string;
  briefDisplayPath: string;
  agentModel?: string;
}

interface ReportOptions {
  cwd?: string;
  force?: boolean;
}

interface ReportOpenOptions {
  runId?: string;
  opener?: (path: string) => void | Promise<void>;
}

interface FlywheelGateSnapshot {
  paused: boolean;
  activeRunId: string | null;
}

interface ResolvedFlywheelRoleConfig {
  harness: 'claude-code' | 'ohmypi' | 'codex';
  model: string;
  effort: RoleEffort;
  minAgents: number;
  maxAgents: number;
  scope: FlywheelScope;
  autoPickupBacklog: boolean;
  requireUatBeforeMerge: boolean;
}

const decodeFlywheelStatus = Schema.decodeUnknownSync(FlywheelStatus);
const decodeFlywheelStats = Schema.decodeUnknownSync(FlywheelStats);
const execAsync = promisify(exec);
const DEFAULT_STATS_WINDOW = '30d';

function dashboardBaseUrl(): string {
  return (process.env.OVERDECK_DASHBOARD_URL || process.env.DASHBOARD_URL || 'http://localhost:3011').replace(/\/$/, '');
}

export async function readFlywheelStatusJson(file: string, input: InputStream = process.stdin): Promise<string> {
  if (file !== '-') return readFile(file, 'utf8');

  const chunks: string[] = [];
  for await (const chunk of input) {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
  }
  return chunks.join('');
}

export function parseFlywheelStatusJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON: ${message}`);
  }
}

export function validateFlywheelStatusPayload(payload: unknown): FlywheelStatus {
  try {
    return decodeFlywheelStatus(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid FlywheelStatus: ${message}`);
  }
}

function isFlywheelConfigKey(key: string): key is FlywheelConfigKey {
  return FLYWHEEL_CONFIG_KEYS.includes(key as FlywheelConfigKey);
}

function parseFlywheelConfigKey(key: string): FlywheelConfigKey {
  if (!isFlywheelConfigKey(key)) throw new Error(`Unknown flywheel config key: ${key}`);
  return key;
}

function readFlywheelConfigValue(key: FlywheelConfigKey): boolean {
  switch (key) {
    case FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY:
      return isFlywheelAutoPickupBacklog();
    case FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY:
      return isFlywheelRequireUatBeforeMerge();
  }
}

function writeFlywheelConfigValue(key: FlywheelConfigKey, value: boolean): void {
  switch (key) {
    case FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY:
      setFlywheelAutoPickupBacklog(value);
      return;
    case FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY:
      setFlywheelRequireUatBeforeMerge(value);
      return;
  }
}

function formatFlywheelConfigValue(key: FlywheelConfigKey): string {
  return `${key}=${readFlywheelConfigValue(key)}`;
}

function parseConfigBoolean(key: string, rawValue: string): boolean {
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  throw new Error(`Boolean value required for ${key}: ${rawValue}`);
}

function parseFlywheelConfigAssignment(assignment: string): { key: FlywheelConfigKey; value: boolean } {
  const separator = assignment.indexOf('=');
  if (separator === -1) throw new Error('Flywheel config assignment must use <key>=<bool>');
  const key = parseFlywheelConfigKey(assignment.slice(0, separator));
  const value = parseConfigBoolean(key, assignment.slice(separator + 1));
  return { key, value };
}

export async function flywheelConfigCommand(options: ConfigOptions = {}): Promise<void> {
  try {
    if (options.get !== undefined && options.set !== undefined) {
      throw new Error('Use either --get or --set, not both');
    }

    if (options.set !== undefined) {
      const { key, value } = parseFlywheelConfigAssignment(options.set);
      writeFlywheelConfigValue(key, value);
      console.log(`${key}=${value}`);
      return;
    }

    if (typeof options.get === 'string') {
      console.log(formatFlywheelConfigValue(parseFlywheelConfigKey(options.get)));
      return;
    }

    console.log(FLYWHEEL_CONFIG_KEYS.map(formatFlywheelConfigValue).join('\n'));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const DEFAULT_BRIEF_PATH = 'docs/flywheel-brief.md';
const FLYWHEEL_CONFIG_KEYS = [
  FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY,
  FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY,
] as const;

type FlywheelConfigKey = typeof FLYWHEEL_CONFIG_KEYS[number];

function isInsideRoot(projectRoot: string, candidate: string): boolean {
  const relativePath = relative(projectRoot, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

export function resolveFlywheelStartBriefPath(cwd: string, requestedPath?: string): { absolutePath: string; displayPath: string } {
  const rawPath = requestedPath?.trim() || DEFAULT_BRIEF_PATH;
  if (rawPath.includes('\0')) throw new Error('Brief path is invalid');

  const root = resolve(cwd);
  const absolutePath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(root, rawPath);
  if (!isInsideRoot(root, absolutePath)) throw new Error('Brief path must stay inside the project root');

  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  const displayPath = absolutePath === root ? '.' : relative(root, absolutePath);
  return { absolutePath, displayPath: absolutePath.startsWith(normalizedRoot) ? displayPath : absolutePath };
}

async function assertExistingPathInsideRoot(projectRoot: string, candidate: string): Promise<void> {
  const [realRoot, realCandidate] = await Promise.all([realpath(projectRoot), realpath(candidate)]);
  if (!isInsideRoot(realRoot, realCandidate)) throw new Error('Brief path must stay inside the project root');
}

export async function requireFlywheelBrief(cwd: string, requestedPath?: string): Promise<{ absolutePath: string; displayPath: string }> {
  const resolved = resolveFlywheelStartBriefPath(cwd, requestedPath);
  try {
    await assertExistingPathInsideRoot(cwd, resolved.absolutePath);
    await readFile(resolved.absolutePath, 'utf8');
    return resolved;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') throw new Error(`Flywheel brief not found: ${resolved.displayPath}`);
    throw error;
  }
}

function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

async function resolveFlywheelRoleConfig(): Promise<ResolvedFlywheelRoleConfig> {
  const { config } = loadConfigSync();
  const flywheel = config.roles?.flywheel;
  const model = resolveModel('flywheel', undefined, config);
  // Harness is provider-default-only (PAN-1984): derive it from the model's provider via the
  // canonical resolver — never a per-role pin or a hardcoded claude-code fallback, which would
  // route gpt-5.5/glm/kimi through CLIProxy into the 200k-window-illusion deadlock (PAN-1865).
  const harness = await resolveHarness({ model });
  return {
    harness,
    model,
    effort: flywheel?.effort ?? 'high',
    minAgents: flywheel?.minAgents ?? 20,
    maxAgents: flywheel?.maxAgents ?? 30,
    scope: flywheel?.scope ?? 'pan-only',
    autoPickupBacklog: isFlywheelAutoPickupBacklog(),
    requireUatBeforeMerge: isFlywheelRequireUatBeforeMerge(),
  };
}

async function createInitialFlywheelStatus(
  runId: string,
  startedAt: string,
  cwd: string,
  agentModel: string | undefined,
  agentHarness: RuntimeName | undefined,
  roleConfig: ResolvedFlywheelRoleConfig,
): Promise<FlywheelStatus> {
  const ramTotalMb = mb(totalmem());
  return {
    runId,
    startedAt,
    elapsedMs: 0,
    orchestrator: {
      harness: agentHarness ?? roleConfig.harness,
      model: agentModel ?? roleConfig.model,
      effort: roleConfig.effort,
      ctxPercent: 0,
    },
    headline: {
      bugsFixed: 0,
      swarmItemsMerged: 0,
      swarmItemsTotal: 0,
      prsMerged: 0,
      awaitingUat: 0,
    },
    activePipeline: [],
    substrateBugs: [],
    agents: [{
      id: FLYWHEEL_ORCHESTRATOR_AGENT_ID,
      label: 'flywheel-orchestrator',
      status: 'running',
      role: 'flywheel',
      model: agentModel,
    }],
    parked: [],
    suggestions: [],
    system: {
      mainHead: await gitOutput('git rev-parse --short HEAD', cwd).catch(() => 'unknown'),
      ramUsedMb: Math.max(0, ramTotalMb - mb(freemem())),
      ramTotalMb,
      swapUsedMb: 0,
      swapTotalMb: 0,
      agentsActive: 1,
      agentsCap: roleConfig.maxAgents,
    },
    openQuestions: [],
    ticks: 0,
    lastTickAt: startedAt,
  };
}

export async function postFlywheelStatus(status: FlywheelStatus, fetchImpl: typeof fetch = fetch): Promise<void> {
  const internalToken = ensureInternalTokenSync();
  const res = await fetchImpl(`${dashboardBaseUrl()}/api/flywheel/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [INTERNAL_TOKEN_HEADER]: internalToken,
    },
    body: JSON.stringify(status),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Dashboard rejected FlywheelStatus (${res.status})${body ? `: ${body}` : ''}`);
  }
}

export async function emitStatusCommand(options: EmitStatusOptions): Promise<void> {
  try {
    const raw = await readFlywheelStatusJson(options.file);
    const payload = parseFlywheelStatusJson(raw);
    const status = validateFlywheelStatusPayload(payload);
    await postFlywheelStatus(status);
    console.log(`Flywheel status emitted for ${status.runId}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export async function startFlywheelRun(options: StartOptions = {}): Promise<StartFlywheelRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const brief = await requireFlywheelBrief(cwd, options.brief);
  const runId = await nextFlywheelRunId();
  const startedAt = new Date().toISOString();
  await writeFlywheelLaunchMetadata({
    version: 1,
    runId,
    workspace: cwd,
    briefPath: brief.absolutePath,
    briefDisplayPath: brief.displayPath,
  });
  const roleConfig = await resolveFlywheelRoleConfig();
  const agent = await spawnFlywheel({
    runId,
    briefPath: brief.absolutePath,
    workspace: cwd,
    model: roleConfig.model,
    harness: roleConfig.harness,
    effort: roleConfig.effort,
    minAgents: roleConfig.minAgents,
    maxAgents: roleConfig.maxAgents,
    scope: roleConfig.scope,
    autoPickupBacklog: roleConfig.autoPickupBacklog,
    requireUatBeforeMerge: roleConfig.requireUatBeforeMerge,
  });
  await writeLatestFlywheelStatus(await createInitialFlywheelStatus(
    runId,
    startedAt,
    cwd,
    agent.model,
    agent.harness,
    roleConfig,
  ));
  return { runId, briefDisplayPath: brief.displayPath, agentModel: agent.model };
}

export async function flywheelStartCommand(options: StartOptions = {}): Promise<void> {
  try {
    const result = await startFlywheelRun(options);

    console.log(`Flywheel started: ${result.runId}`);
    console.log(`Brief: ${result.briefDisplayPath}`);
    console.log(`Run URL: ${dashboardBaseUrl()}/flywheel`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

async function loadActiveFlywheelStatus(): Promise<FlywheelStatus | null> {
  // resolveLiveFlywheelRunId self-heals the SQLite gate when the prior run
  // has ended or its on-disk state is gone (PAN-1245). Status and start now
  // consult the same source of truth.
  const activeRunId = await resolveLiveFlywheelRunId();
  if (!activeRunId) return null;
  const detail = await getFlywheelRunDetail(activeRunId);
  return detail?.status === 'running' ? detail.latest : null;
}

export function formatFlywheelStatus(status: FlywheelStatus): string {
  return [
    `Run: ${status.runId}`,
    `Elapsed: ${formatElapsed(status.elapsedMs)}`,
    `Bugs fixed: ${status.headline.bugsFixed}`,
    `SWARM items: ${status.headline.swarmItemsMerged}/${status.headline.swarmItemsTotal}`,
    `PRs merged: ${status.headline.prsMerged}`,
    `Awaiting UAT: ${status.headline.awaitingUat}`,
    `Active agents: ${status.system.agentsActive}/${status.system.agentsCap}`,
    `RAM: ${status.system.ramUsedMb} MiB used / ${status.system.ramTotalMb} MiB total`,
    `Main HEAD: ${status.system.mainHead.slice(0, 7)}`,
    `Last tick: ${status.lastTickAt}`,
  ].join('\n');
}

export async function flywheelStatusCommand(options: StatusOptions): Promise<void> {
  try {
    const status = await loadActiveFlywheelStatus();
    if (!status) {
      console.error('no active flywheel run');
      process.exitCode = 1;
      return;
    }

    const mergeBackend = await loadMergeBackendStatusForCli();
    console.log(options.json
      ? JSON.stringify({ ...status, mergeBackend }, null, 2)
      : `${formatFlywheelStatus(status)}\n${formatMergeBackendStatus(mergeBackend)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const STATS_CRITERION_KEYS = [
  'c1_bugRate',
  'c2_p0Bugs',
  'c3_passRate',
  'c4_mttr',
  'c5_intervention',
  'c6_timeConsistency',
  'c7_flake',
] as const satisfies readonly (keyof FlywheelStatsCriteria)[];

const STATUS_GLYPH: Record<FlywheelStatsCriterionStatus, string> = {
  green: '● green',
  yellow: '● yellow',
  red: '● red',
  insufficient_data: '○ insufficient_data',
};

const STATUS_COLOR: Record<FlywheelStatsCriterionStatus, string> = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  insufficient_data: '\x1b[90m',
};

const TREND_LABEL: Record<FlywheelStatsTrend, string> = {
  up: '↗ up',
  down: '↘ down',
  flat: '→ flat',
};

export async function fetchFlywheelStats(window: string, fetchImpl: typeof fetch = fetch): Promise<FlywheelStatsPayload> {
  const internalToken = ensureInternalTokenSync();
  const url = new URL(`${dashboardBaseUrl()}/api/flywheel/stats`);
  url.searchParams.set('window', window);
  const res = await fetchImpl(url.toString(), {
    headers: {
      [INTERNAL_TOKEN_HEADER]: internalToken,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Dashboard rejected Flywheel stats request (${res.status})${body ? `: ${body}` : ''}`);
  }

  return decodeFlywheelStats(await res.json());
}

function formatScalar(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value > 0 && Math.abs(value) < 1) return `${(value * 100).toFixed(1)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs >= 24 * 60 * 60 * 1000) return `${(ms / (24 * 60 * 60 * 1000)).toFixed(1)}d`;
  if (abs >= 60 * 60 * 1000) return `${(ms / (60 * 60 * 1000)).toFixed(1)}h`;
  if (abs >= 60 * 1000) return `${(ms / (60 * 1000)).toFixed(1)}m`;
  return `${Math.round(ms)}ms`;
}

function formatObjectValue(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, entry]) => {
      if (typeof entry === 'number' && key.toLowerCase().endsWith('ms')) return `${key}: ${formatDuration(entry)}`;
      if (typeof entry === 'number') return `${key}: ${formatScalar(entry)}`;
      if (typeof entry === 'string' || typeof entry === 'boolean' || entry === null) return `${key}: ${String(entry)}`;
      return `${key}: ${JSON.stringify(entry)}`;
    })
    .join(', ');
}

function formatCriterionValue(value: FlywheelStatsCriterion['value']): string {
  return typeof value === 'number' ? formatScalar(value) : formatObjectValue(value as Record<string, unknown>);
}

function colorStatus(status: FlywheelStatsCriterionStatus, color: boolean): string {
  if (!color) return STATUS_GLYPH[status];
  const [glyph, label] = STATUS_GLYPH[status].split(' ');
  return `${STATUS_COLOR[status]}${glyph}\x1b[0m ${label}`;
}

function tableStatsCell(value: string | number | undefined): string {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function formatFlywheelStats(stats: FlywheelStatsPayload, options: FormatStatsOptions = {}): string {
  const color = options.color ?? process.stdout.isTTY === true;
  const rows = STATS_CRITERION_KEYS.map((key) => {
    const criterion = stats.criteria[key];
    return `| ${tableStatsCell(criterion.label)} | ${tableStatsCell(formatCriterionValue(criterion.value))} | ${tableStatsCell(formatCriterionValue(criterion.target))} | ${tableStatsCell(colorStatus(criterion.status, color))} | ${tableStatsCell(criterion.trend ? TREND_LABEL[criterion.trend] : '—')} | ${criterion.sampleSize} |`;
  });
  return [
    `Flywheel stats (${stats.window})`,
    `Generated: ${stats.generatedAt}`,
    '',
    '| Criterion | Value | Target | Status | Trend | Sample |',
    '|---|---:|---:|---|---|---:|',
    ...rows,
  ].join('\n');
}

export async function flywheelStatsCommand(options: StatsOptions = {}): Promise<void> {
  try {
    const stats = await fetchFlywheelStats(options.window ?? DEFAULT_STATS_WINDOW);
    console.log(options.json ? JSON.stringify(stats, null, 2) : formatFlywheelStats(stats));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function runNumberFromRunId(runId: string): number {
  const match = /^RUN-(\d+)$/.exec(runId);
  if (!match) throw new Error(`Invalid Flywheel run id for report: ${runId}`);
  return Number(match[1]);
}

function reportDate(status: FlywheelStatus): string {
  return status.lastTickAt.slice(0, 10);
}

function tableCell(value: string | number | undefined): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function formatFlywheelStateReport(status: FlywheelStatus, mergeQueue: MergeQueueItem[] = []): string {
  const runNumber = runNumberFromRunId(status.runId);
  const suggestionRows = status.suggestions.length > 0
    ? status.suggestions.map((suggestion) => `| ${tableCell(suggestion.priority)} | ${tableCell(suggestion.action)} | ${tableCell(suggestion.issueId)} | ${tableCell(suggestion.rationale)} |`).join('\n')
    : 'No suggestions emitted this run.';
  const activePipelineRows = status.activePipeline.length > 0
    ? status.activePipeline.map((item) => `| ${tableCell(item.issueId)} | ${tableCell(item.verb)} | ${tableCell(item.status)} | ${tableCell(item.title)} | ${tableCell(item.progressPercent)} | ${tableCell(item.pr)} |`).join('\n')
    : '| _None_ |  |  |  |  |  |';
  const substrateRows = status.substrateBugs.length > 0
    ? status.substrateBugs.map((bug) => `| ${tableCell(bug.issueId)} | ${tableCell(bug.status)} | ${tableCell(bug.title)} | ${tableCell(bug.commitSha?.slice(0, 10))} |`).join('\n')
    : '| _None_ |  |  |  |';
  const patternLines = status.parked.length > 0
    ? status.parked.map((item) => `- **${item.issueId}** (${item.reason}) — ${item.title}`).join('\n')
    : '- None recorded this run.';
  const questionLines = status.openQuestions.length > 0
    ? status.openQuestions.map((question) => `- ${question}`).join('\n')
    : '- None.';
  const mergeQueueSection = mergeQueue.length > 0
    ? `## Merge Queue

Merge ship-ready PRs in this order to avoid rebase conflicts. Branches with overlapping file changes must be merged in sequence; non-overlapping branches can be merged in any order.

| # | Issue | PR | Conflicts With |
|---|---|---|---|
${mergeQueue.map((item) => {
  const prCell = item.pr != null ? `#${item.pr}` : '—';
  const conflictsCell = item.conflictsWith.length > 0 ? item.conflictsWith.join(', ') : '—';
  return `| ${item.mergeOrder} | ${item.issueId} | ${prCell} | ${conflictsCell} |`;
}).join('\n')}

---

`
    : '';

  return `# Flywheel Run ${runNumber} Report — ${reportDate(status)}

Per-run report derived from the last \`FlywheelStatus\` snapshot. Durable cumulative memory across runs lives in \`docs/FLYWHEEL-STATE.md\`.

**Run window:** ${status.startedAt} → ${status.lastTickAt} (${status.orchestrator.harness}, ${status.orchestrator.model}, ${status.orchestrator.effort})

**Headline result:** ${status.headline.bugsFixed} substrate bugs fixed; ${status.headline.swarmItemsMerged}/${status.headline.swarmItemsTotal} SWARM items merged; ${status.headline.prsMerged} PRs merged; ${status.headline.awaitingUat} awaiting UAT.

**Run counters:** ticks ${status.ticks}; last tick ${status.lastTickAt}; orchestrator context ${status.orchestrator.ctxPercent}%.

---

${mergeQueueSection}## Suggestions

${status.suggestions.length > 0 ? `| Priority | Action | Issue | Rationale |
|---|---|---|---|
${suggestionRows}` : suggestionRows}

---

## Active Pipeline

| Issue | Verb | Status | Title | Progress | PR |
|---|---|---|---|---:|---:|
${activePipelineRows}

---

## Cycling Alerts

${questionLines}

---

## Infrastructure Gaps

| Issue | Status | Notes | Commit |
|---|---|---|---|
${substrateRows}

---

## Pattern Ledger

${patternLines}

---

## Skill Gaps

- Keep \`pan flywheel report\` in the closeout path so run summaries stay archived under the run directory.
`;
}

async function isFlywheelStateDirty(cwd: string): Promise<boolean> {
  // Tolerate non-git cwd / missing file: a non-zero git exit means there are
  // no orchestrator-authored changes worth committing here (PAN-1245). The
  // gate clear in flywheelReportCommand must not be blocked by this check.
  try {
    const { stdout } = await execAsync(
      'git status --porcelain docs/FLYWHEEL-STATE.md',
      { cwd, encoding: 'utf8' },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function loadReportFlywheelStatus(): Promise<FlywheelStatus | null> {
  const activeRunId = getFlywheelActiveRunId();
  if (activeRunId) {
    const activeDetail = await getFlywheelRunDetail(activeRunId);
    if (activeDetail?.latest) return activeDetail.latest;
  }
  const runs = await listFlywheelRuns();
  const run = runs.find((candidate) => candidate.status === 'running') ?? runs[0];
  if (!run) return null;
  const detail = await getFlywheelRunDetail(run.id);
  return detail?.latest ?? null;
}

async function gitOutput(command: string, cwd: string): Promise<string> {
  const { stdout } = await execAsync(command, { cwd, encoding: 'utf8' });
  return stdout.trim();
}

async function commitFlywheelStateChanges(cwd: string, runNumber: number): Promise<void> {
  const subject = `docs(flywheel): run ${runNumber}`;
  await execAsync('git add docs/FLYWHEEL-STATE.md', { cwd });
  const headSubject = await gitOutput('git log -1 --format=%s', cwd).catch(() => '');
  const command = headSubject === subject
    ? `git commit --amend -m ${JSON.stringify(subject)}`
    : `git commit -m ${JSON.stringify(subject)}`;
  await execAsync(command, { cwd, encoding: 'utf8' });
}

function readFlywheelGateSnapshot(): FlywheelGateSnapshot {
  return {
    paused: isFlywheelGloballyPaused(),
    activeRunId: getFlywheelActiveRunId(),
  };
}

function formatGateSnapshot(snapshot: FlywheelGateSnapshot): string {
  return `paused=${snapshot.paused ? 'true' : 'false'} active_run_id=${snapshot.activeRunId ?? 'none'}`;
}

export async function pauseFlywheelRun(): Promise<{ before: FlywheelGateSnapshot; after: FlywheelGateSnapshot; changed: boolean }> {
  const before = readFlywheelGateSnapshot();
  if (before.paused) return { before, after: before, changed: false };
  await pauseFlywheel();
  return { before, after: readFlywheelGateSnapshot(), changed: true };
}

export async function flywheelPauseCommand(): Promise<void> {
  try {
    const result = await pauseFlywheelRun();
    if (!result.changed) {
      console.log(`Flywheel already paused (${formatGateSnapshot(result.before)})`);
      return;
    }

    console.log(`Flywheel paused: before ${formatGateSnapshot(result.before)}; after ${formatGateSnapshot(result.after)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export async function resumeFlywheelRun(): Promise<{ before: FlywheelGateSnapshot; after: FlywheelGateSnapshot; changed: boolean }> {
  const before = readFlywheelGateSnapshot();
  if (!before.paused && await Effect.runPromise(sessionExists(FLYWHEEL_ORCHESTRATOR_AGENT_ID))) {
    return { before, after: before, changed: false };
  }
  if (!before.activeRunId) throw new Error('No active flywheel run to resume');
  const launch = await readFlywheelLaunchMetadata(before.activeRunId);
  if (!launch) {
    throw new Error(`Flywheel run ${before.activeRunId} is missing launch metadata; cannot resume safely`);
  }
  const brief = await requireFlywheelBrief(launch.workspace, launch.briefPath);
  const roleConfig = await resolveFlywheelRoleConfig();
  await resumeFlywheel({
    workspace: launch.workspace,
    briefPath: brief.absolutePath,
    model: roleConfig.model,
    harness: roleConfig.harness,
    effort: roleConfig.effort,
    minAgents: roleConfig.minAgents,
    maxAgents: roleConfig.maxAgents,
    scope: roleConfig.scope,
    autoPickupBacklog: roleConfig.autoPickupBacklog,
    requireUatBeforeMerge: roleConfig.requireUatBeforeMerge,
  });
  return { before, after: readFlywheelGateSnapshot(), changed: true };
}

export async function flywheelResumeCommand(): Promise<void> {
  try {
    const result = await resumeFlywheelRun();
    if (!result.changed) {
      console.log(`Flywheel already running (${formatGateSnapshot(result.before)})`);
      return;
    }

    console.log(`Flywheel resumed: before ${formatGateSnapshot(result.before)}; after ${formatGateSnapshot(result.after)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function clearFlywheelRunGate(runId: string): void {
  if (getFlywheelActiveRunId() === runId) {
    clearFlywheelGate();
  }
}

// Gracefully stop the Flywheel orchestrator: kill any live session, write the
// per-run report, commit any FLYWHEEL-STATE.md changes, and clear the active-run
// gate. Idempotent: a no-op when nothing is running and nothing is left to
// report.
export async function flywheelStopCommand(): Promise<void> {
  try {
    const sessionAlive = await Effect.runPromise(sessionExists(FLYWHEEL_ORCHESTRATOR_AGENT_ID));
    if (sessionAlive) {
      await Effect.runPromise(stopAgent(FLYWHEEL_ORCHESTRATOR_AGENT_ID));
    }

    const status = await loadReportFlywheelStatus();
    if (!status) {
      console.log('No flywheel run is active and nothing is left to report.');
      return;
    }

    // The orchestrator has already been stopped, so force the report path to
    // bypass its alive-session guard and finalize the run.
    await flywheelReportCommand({ force: true });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export async function flywheelReportCommand(options: ReportOptions = {}): Promise<void> {
  try {
    const cwd = options.cwd ?? process.cwd();

    // Writing report.md finalizes the run (clears the active-run gate and
    // makes deriveRunStatus → 'complete'). Refuse if the orchestrator session
    // is still alive, since that would silently terminate a live run. The
    // orchestrator's own end-of-run call passes --force to bypass this guard.
    if (!options.force && await Effect.runPromise(sessionExists(FLYWHEEL_ORCHESTRATOR_AGENT_ID))) {
      console.error('Refusing to write report — flywheel orchestrator session is still alive.');
      console.error('This command finalizes the run (writes report.md and clears the active-run gate).');
      console.error('Run `pan flywheel pause` (or `pan flywheel abort`) first, or pass --force to override.');
      process.exitCode = 1;
      return;
    }

    const status = await loadReportFlywheelStatus();
    if (!status) {
      console.error('no flywheel run to report');
      process.exitCode = 1;
      return;
    }

    const runNumber = runNumberFromRunId(status.runId);
    const mergeQueue = await Effect.runPromise(
      computeMergeQueue(status.activePipeline, cwd).pipe(Effect.provide(nodeServicesLayer)),
    );
    const runReport = formatFlywheelStateReport(status, mergeQueue);
    await writeFile(join(getFlywheelRunDir(status.runId), 'report.md'), runReport, 'utf8');

    // PAN-1245: the gate must clear once report.md is written, even if the
    // commit phase fails (non-git cwd, no FLYWHEEL-STATE.md changes, hook
    // failure). Otherwise a partial report leaves the gate stuck and the
    // next `pan flywheel start` is blocked.
    try {
      const stateChanged = await isFlywheelStateDirty(cwd);
      if (stateChanged) {
        await commitFlywheelStateChanges(cwd, runNumber);
        console.log(`Wrote per-run report and committed FLYWHEEL-STATE.md changes for run ${runNumber}.`);
      } else {
        console.log(`Wrote per-run report for run ${runNumber}. No FLYWHEEL-STATE.md changes to commit.`);
      }
    } finally {
      clearFlywheelRunGate(status.runId);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function getPlatformOpenCommand(): string {
  switch (process.platform) {
    case 'linux': return 'xdg-open';
    case 'darwin': return 'open';
    case 'win32': return 'explorer';
    default: throw new Error(`Opening files is not supported on ${process.platform}`);
  }
}

function openPathDetached(path: string): void {
  const child = spawn(getPlatformOpenCommand(), [path], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function resolveReportOpenRunId(runId: string | undefined): Promise<string> {
  if (runId) return runId;
  const runs = await listFlywheelRuns();
  const run = runs.find((candidate) => candidate.status === 'complete') ?? runs[0];
  if (!run) throw new Error('no flywheel run report to open');
  return run.id;
}

export async function openFlywheelRunReport(options: ReportOpenOptions = {}): Promise<{ runId: string; path: string }> {
  const runId = await resolveReportOpenRunId(options.runId);
  const detail = await getFlywheelRunDetail(runId);
  if (!detail) throw new Error(`Flywheel run not found: ${runId}`);
  if (!detail.paths.report) throw new Error(`No report exists for ${runId}`);
  await (options.opener ?? openPathDetached)(detail.paths.report);
  return { runId, path: detail.paths.report };
}

export async function flywheelReportOpenCommand(options: ReportOpenOptions = {}): Promise<void> {
  try {
    const result = await openFlywheelRunReport(options);
    console.log(`Opened Flywheel report for ${result.runId}: ${result.path}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

// Discard the current flywheel run without writing a report (PAN-1245). Used
// when a run is stuck post-reboot, or when the user wants a clean slate
// without ceremony. Stops the orchestrator if attached, writes aborted.json,
// clears the gate. Idempotent: a no-op when nothing is active.
export async function flywheelAbortCommand(): Promise<void> {
  try {
    const candidate = getFlywheelActiveRunId();
    if (!candidate) {
      console.log('No active flywheel run to abort.');
      return;
    }
    await Effect.runPromise(stopAgent(FLYWHEEL_ORCHESTRATOR_AGENT_ID));
    await abortFlywheelRun(candidate);
    console.log(`Aborted flywheel run ${candidate}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export function registerFlywheelCommands(program: Command): void {
  const flywheel = program
    .command('flywheel')
    .description('Flywheel orchestrator lifecycle and status helpers');

  flywheel
    .command('start')
    .description('Start the Flywheel orchestrator')
    .option('--brief <path>', 'Path to the Flywheel brief', DEFAULT_BRIEF_PATH)
    .action(flywheelStartCommand);

  flywheel
    .command('emit-status')
    .description('Validate and publish a FlywheelStatus JSON snapshot to the local dashboard')
    .requiredOption('--file <path>', 'Path to FlywheelStatus JSON, or - to read from stdin')
    .action(emitStatusCommand);

  flywheel
    .command('config')
    .description('Get or set Flywheel autonomy configuration')
    .option('--get [key]', 'Print Flywheel config values')
    .option('--set <key=value>', 'Set a Flywheel config boolean')
    .action(flywheelConfigCommand);

  flywheel
    .command('status')
    .description('Show the active Flywheel run status')
    .option('--json', 'Emit the raw FlywheelStatus JSON')
    .action(flywheelStatusCommand);

  flywheel
    .command('stats')
    .description('Show Flywheel v1.0 readiness stats')
    .option('--window <duration>', 'Stats window duration', DEFAULT_STATS_WINDOW)
    .option('--json', 'Emit the raw FlywheelStats JSON')
    .action(flywheelStatsCommand);

  flywheel
    .command('pause')
    .description('Pause the active Flywheel orchestrator run')
    .action(flywheelPauseCommand);

  flywheel
    .command('resume')
    .description('Resume the paused Flywheel orchestrator run')
    .action(flywheelResumeCommand);

  flywheel
    .command('report')
    .description('Finalize the active Flywheel run: write report.md, commit FLYWHEEL-STATE.md changes, and clear the active-run gate. Refuses to run while the orchestrator session is alive (pause or abort first).')
    .option('--force', 'Bypass the orchestrator-alive guard. Intended for the orchestrator role\'s own end-of-run call.')
    .action(flywheelReportCommand);

  flywheel
    .command('stop')
    .description('Stop the Flywheel orchestrator gracefully: kill any live session, write report.md, commit FLYWHEEL-STATE.md changes, and clear the active-run gate')
    .action(flywheelStopCommand);

  flywheel
    .command('abort')
    .description('Discard the active Flywheel run without writing a report')
    .action(flywheelAbortCommand);
}
