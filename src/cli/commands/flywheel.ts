import { exec, spawn } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { freemem, totalmem } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { Effect, Schema } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';
import { Command } from 'commander';
import { FlywheelStatus } from '@panctl/contracts';
import { abortFlywheelRun, clearFlywheelGate, getFlywheelRunDetail, getFlywheelRunDir, listFlywheelRuns, nextFlywheelRunId, readFlywheelLaunchMetadata, resolveLiveFlywheelRunId, writeFlywheelLaunchMetadata, writeLatestFlywheelStatus } from '../../dashboard/server/services/flywheel-run-state.js';
import { loadConfigSync, resolveModel, type FlywheelScope, type RoleEffort } from '../../lib/config-yaml.js';
import { FLYWHEEL_ORCHESTRATOR_AGENT_ID, pauseFlywheel, resumeFlywheel, spawnFlywheel } from '../../lib/cloister/flywheel.js';
import { stopAgent } from '../../lib/agents.js';
import { getFlywheelActiveRunId, isFlywheelGloballyPaused } from '../../lib/database/app-settings.js';
import { sessionExists } from '../../lib/tmux.js';
import { ensureInternalTokenSync, INTERNAL_TOKEN_HEADER } from '../../lib/internal-token.js';
import { computeMergeQueue, type MergeQueueItem } from '../../lib/flywheel-merge-order.js';

type InputStream = AsyncIterable<string | Buffer | Uint8Array>;

interface EmitStatusOptions {
  file: string;
}

interface StatusOptions {
  json?: boolean;
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
  harness: 'claude-code' | 'pi';
  model: string;
  effort: RoleEffort;
  maxAgents: number;
  scope: FlywheelScope;
}

const decodeFlywheelStatus = Schema.decodeUnknownSync(FlywheelStatus);
const execAsync = promisify(exec);

function dashboardBaseUrl(): string {
  return (process.env.PANOPTICON_DASHBOARD_URL || process.env.DASHBOARD_URL || 'http://localhost:3011').replace(/\/$/, '');
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

const DEFAULT_BRIEF_PATH = 'docs/flywheel-brief.md';

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

function resolveFlywheelRoleConfig(): ResolvedFlywheelRoleConfig {
  const { config } = loadConfigSync();
  const flywheel = config.roles?.flywheel;
  return {
    harness: flywheel?.harness ?? 'claude-code',
    model: resolveModel('flywheel', undefined, config),
    effort: flywheel?.effort ?? 'high',
    maxAgents: flywheel?.maxAgents ?? 8,
    scope: flywheel?.scope ?? 'pan-only',
  };
}

async function createInitialFlywheelStatus(
  runId: string,
  startedAt: string,
  cwd: string,
  agentModel: string | undefined,
  agentHarness: 'claude-code' | 'pi' | undefined,
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
  const roleConfig = resolveFlywheelRoleConfig();
  const agent = await spawnFlywheel({
    runId,
    briefPath: brief.absolutePath,
    workspace: cwd,
    model: roleConfig.model,
    harness: roleConfig.harness,
    effort: roleConfig.effort,
    maxAgents: roleConfig.maxAgents,
    scope: roleConfig.scope,
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

    console.log(options.json ? JSON.stringify(status, null, 2) : formatFlywheelStatus(status));
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

${mergeQueueSection}## Active Pipeline

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
  const roleConfig = resolveFlywheelRoleConfig();
  await resumeFlywheel({
    workspace: launch.workspace,
    briefPath: brief.absolutePath,
    model: roleConfig.model,
    harness: roleConfig.harness,
    effort: roleConfig.effort,
    maxAgents: roleConfig.maxAgents,
    scope: roleConfig.scope,
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

export async function flywheelReportCommand(options: ReportOptions = {}): Promise<void> {
  try {
    const cwd = options.cwd ?? process.cwd();
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
    .command('status')
    .description('Show the active Flywheel run status')
    .option('--json', 'Emit the raw FlywheelStatus JSON')
    .action(flywheelStatusCommand);

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
    .description('Write and commit the current Flywheel run report')
    .action(flywheelReportCommand);

  flywheel
    .command('abort')
    .description('Discard the active Flywheel run without writing a report')
    .action(flywheelAbortCommand);
}
