import { exec, spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { freemem, totalmem } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { FlywheelStatus } from '@overdeck/contracts';
import { Effect } from 'effect';
import { loadConfigNoMigration, resolveModel, type FlywheelScope, type RoleEffort } from '../../../lib/config-yaml.js';
import { resolveHarness } from '../../../lib/harness-resolve.js';
import { FLYWHEEL_ORCHESTRATOR_AGENT_ID, isFlywheelDevcontainerRuntime, loadResumeSessionId, saveResumeSessionId, spawnFlywheelAgent } from '../../../lib/cloister/flywheel.js';
import { FLYWHEEL_ACTIVE_RUN_ID_KEY, FLYWHEEL_GLOBAL_PAUSE_KEY } from '../../../lib/overdeck/control-settings.js';
import { isPaneDead, killSession, sessionExists } from '../../../lib/tmux.js';
import {
  abortFlywheelRun,
  getFlywheelRunDetail,
  listFlywheelRuns,
  nextFlywheelRunId,
  readFlywheelLaunchMetadata,
  resolveLiveFlywheelRunId,
  writeFlywheelLaunchMetadata,
  writeLatestFlywheelStatus,
} from './flywheel-run-state.js';
import { runDashboardDbJob } from './dashboard-db-task.js';

interface StartOptions {
  brief?: string;
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
  harness: 'claude-code' | 'ohmypi' | 'codex';
  model: string;
  effort: RoleEffort;
  minAgents: number;
  maxAgents: number;
  scope: FlywheelScope;
}

const DEFAULT_BRIEF_PATH = 'docs/flywheel-brief.md';
const execAsync = promisify(exec);

function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

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

async function dashboardSetting(key: string): Promise<string | null> {
  return runDashboardDbJob<string | null>('getSetting', key);
}

async function setDashboardSetting(key: string, value: string): Promise<void> {
  await runDashboardDbJob('setSetting', { key, value });
}

async function getActiveRunId(): Promise<string | null> {
  const value = await dashboardSetting(FLYWHEEL_ACTIVE_RUN_ID_KEY);
  return value && value.trim() ? value : null;
}

async function setActiveRunId(runId: string | null): Promise<void> {
  await setDashboardSetting(FLYWHEEL_ACTIVE_RUN_ID_KEY, runId ?? '');
}

async function isPaused(): Promise<boolean> {
  return (await dashboardSetting(FLYWHEEL_GLOBAL_PAUSE_KEY)) === 'true';
}

async function setPaused(paused: boolean): Promise<void> {
  await setDashboardSetting(FLYWHEEL_GLOBAL_PAUSE_KEY, paused ? 'true' : 'false');
}

async function readGateSnapshot(): Promise<FlywheelGateSnapshot> {
  const [paused, activeRunId] = await Promise.all([isPaused(), getActiveRunId()]);
  return { paused, activeRunId };
}

async function resolveFlywheelRoleConfig(): Promise<ResolvedFlywheelRoleConfig> {
  const { config } = await Effect.runPromise(loadConfigNoMigration());
  const flywheel = config.roles?.flywheel;
  const model = resolveModel('flywheel', undefined, config);
  // Harness is provider-default-only (PAN-1984): derive from the model's provider via the
  // canonical resolver — never a per-role pin or a hardcoded claude-code fallback (PAN-1865).
  const harness = await resolveHarness({ model });
  return {
    harness,
    model,
    effort: flywheel?.effort ?? 'high',
    minAgents: flywheel?.minAgents ?? 20,
    maxAgents: flywheel?.maxAgents ?? 30,
    scope: flywheel?.scope ?? 'pan-only',
  };
}

async function gitOutput(command: string, cwd: string): Promise<string> {
  const { stdout } = await execAsync(command, { cwd, encoding: 'utf8' });
  return stdout.trim();
}

async function createInitialFlywheelStatus(
  runId: string,
  startedAt: string,
  cwd: string,
  agentModel: string | undefined,
  agentHarness: 'claude-code' | 'ohmypi' | 'codex' | undefined,
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

export async function startFlywheelRunForDashboard(options: StartOptions = {}): Promise<{ runId: string; briefDisplayPath: string; agentModel?: string }> {
  const cwd = options.cwd ?? process.cwd();
  if (isFlywheelDevcontainerRuntime()) {
    throw new Error('Refusing to spawn flywheel-orchestrator inside a workspace devcontainer');
  }

  // Self-healing gate check (PAN-1245). Mirrors the CLI's spawnFlywheel guard
  // so the two start paths agree about what counts as "active".
  const activeRunId = await resolveLiveFlywheelRunId();
  if (activeRunId) {
    // Auto-abort when the orchestrator process has exited (Pi/ohmypi exited
    // without writing report.md or aborted.json — a "keep-alive corpse").
    // sessionExists only checks if the tmux session exists, not if the pane
    // process is alive. Use isPaneDead which checks #{pane_dead}.
    const sessionMissing = !(await Effect.runPromise(sessionExists(FLYWHEEL_ORCHESTRATOR_AGENT_ID)));
    const paneDead = sessionMissing || await Effect.runPromise(isPaneDead(FLYWHEEL_ORCHESTRATOR_AGENT_ID));
    if (paneDead) {
      console.log(`[flywheel] ${activeRunId} gate stuck — orchestrator pane is dead; auto-aborting`);
      // Kill the stale tmux session directly — stopAgent may fail if the agent
      // is not yet in the DB (e.g. after a rebuild). killSession is sufficient
      // to clear the "already running" guard in spawnFlywheelAgent.
      await Effect.runPromise(killSession(FLYWHEEL_ORCHESTRATOR_AGENT_ID)).catch(() => {});
      await abortFlywheelRun(activeRunId);
    } else {
      throw new Error(`Flywheel run ${activeRunId} is already active; pause, resume, or report it before starting another run`);
    }
  }

  const brief = await requireFlywheelBrief(cwd, options.brief ?? DEFAULT_BRIEF_PATH);
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
  const agent = await spawnFlywheelAgent(runId, {
    briefPath: brief.absolutePath,
    workspace: cwd,
    model: roleConfig.model,
    harness: roleConfig.harness,
    effort: roleConfig.effort,
    minAgents: roleConfig.minAgents,
    maxAgents: roleConfig.maxAgents,
    scope: roleConfig.scope,
  });
  await setActiveRunId(runId);
  await setPaused(false);
  await writeLatestFlywheelStatus(await createInitialFlywheelStatus(
    runId,
    startedAt,
    cwd,
    agent.model,
    agent.harness,
    roleConfig,
  ));
  const resolved = resolveFlywheelStartBriefPath(cwd, options.brief ?? DEFAULT_BRIEF_PATH);
  return { runId, briefDisplayPath: resolved.displayPath, agentModel: agent.model };
}

export async function pauseFlywheelRunForDashboard(): Promise<{ before: FlywheelGateSnapshot; after: FlywheelGateSnapshot; changed: boolean }> {
  const before = await readGateSnapshot();
  if (before.paused) return { before, after: before, changed: false };
  if (before.activeRunId) {
    try {
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { getAgentDir } = await import('../../../lib/agents.js');
      const sessionId = (await readFile(join(getAgentDir(FLYWHEEL_ORCHESTRATOR_AGENT_ID), 'session.id'), 'utf-8')).trim();
      if (sessionId) await saveResumeSessionId(before.activeRunId, sessionId);
    } catch { /* non-fatal: resume falls back to fresh if session.id is missing */ }
  }
  await setPaused(true);
  await import('../../../lib/agents.js').then(({ stopAgent }) => Effect.runPromise(stopAgent(FLYWHEEL_ORCHESTRATOR_AGENT_ID)));
  return { before, after: await readGateSnapshot(), changed: true };
}

// Discard the current flywheel run without writing a report (PAN-1245). Stops
// the orchestrator if still attached, writes `aborted.json`, clears the gate.
// Safe to call from any state: returns { aborted: null } when nothing was live.
export async function abortFlywheelRunForDashboard(): Promise<{ aborted: string | null }> {
  const candidate = await getActiveRunId();
  if (!candidate) {
    // Defensive cleanup: gate could be in a half-cleared state.
    const stale = await resolveLiveFlywheelRunId();
    return { aborted: stale ?? null };
  }
  const { stopAgent } = await import('../../../lib/agents.js');
  await Effect.runPromise(stopAgent(FLYWHEEL_ORCHESTRATOR_AGENT_ID));
  await abortFlywheelRun(candidate);
  return { aborted: candidate };
}

export async function resumeFlywheelRunForDashboard(): Promise<{ before: FlywheelGateSnapshot; after: FlywheelGateSnapshot; changed: boolean }> {
  const before = await readGateSnapshot();
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
  const resumeSessionId = await loadResumeSessionId(before.activeRunId) ?? undefined;
  await spawnFlywheelAgent(before.activeRunId, {
    workspace: launch.workspace,
    briefPath: brief.absolutePath,
    model: roleConfig.model,
    harness: roleConfig.harness,
    effort: roleConfig.effort,
    minAgents: roleConfig.minAgents,
    maxAgents: roleConfig.maxAgents,
    scope: roleConfig.scope,
    resumeSessionId,
  });
  await setPaused(false);
  return { before, after: await readGateSnapshot(), changed: true };
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

export async function openFlywheelRunReportForDashboard(options: ReportOpenOptions = {}): Promise<{ runId: string; path: string }> {
  const runId = await resolveReportOpenRunId(options.runId);
  const detail = await getFlywheelRunDetail(runId);
  if (!detail) throw new Error(`Flywheel run not found: ${runId}`);
  if (!detail.paths.report) throw new Error(`No report exists for ${runId}`);
  await (options.opener ?? openPathDetached)(detail.paths.report);
  return { runId, path: detail.paths.report };
}

export async function readCurrentFlywheelStatusForDashboard(): Promise<FlywheelStatus | null> {
  // Use the self-healing resolver so the dashboard "current run" surface and
  // the CLI's `pan flywheel status` agree (PAN-1245).
  const activeRunId = await resolveLiveFlywheelRunId();
  if (!activeRunId) return null;
  const activeRun = await getFlywheelRunDetail(activeRunId);
  return activeRun?.status === 'running' ? activeRun.latest : null;
}
