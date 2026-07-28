import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { Effect } from 'effect';
import type { AgentStatus } from '@overdeck/contracts';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { getAgentSessionsSync, listSessionNamesSync } from '../../lib/tmux.js';
import { listProjectsSync, getProjectSync, resolveProjectFromIssueSync, type ProjectConfig } from '../../lib/projects.js';
import {
  defaultWorkspacePath,
  inferIssueIdFromStackContainerName,
  tryComposeProjectNameForWorkspace,
} from '../../lib/workspace/stack-health.js';
import { homedir } from 'os';
import { isAbsolute, join, resolve } from 'path';
import {
  OVERDECK_HOME,
  SKILLS_DIR,
  COMMANDS_DIR,
  AGENTS_DIR,
  CLAUDE_DIR,
  ohmypiExtensionCandidates,
} from '../../lib/paths.js';
import { cleanupClosedIssueAgentDirectories } from '../../lib/agent-directory-cleanup.js';
import { normalizeAgentId, getAgentStateSync } from '../../lib/agents.js';
import { readOhmypiCodexCredential } from '../../lib/ohmypi-codex-auth.js';
import { getDashboardApiUrlSync } from '../../lib/config.js';
import { CacheService } from '../../dashboard/server/services/cache-service.js';
import { classifyDashboardAgent } from '../../dashboard/frontend/src/lib/agent-classifier.js';
import { getMainDivergence, type MainDivergence } from '../../lib/state-plane.js';
import {
  checkSystemPrerequisite,
  type PrerequisiteProbe,
  type PrerequisiteResolver,
} from '../../lib/system-prerequisites.js';
import { checkInotify } from './doctor-inotify.js';
import { checkStateWorktrees } from './doctor-state-worktree.js';
import {
  assessBridgePoolPressure,
  bridgePoolLimitFromPools,
  DEFAULT_DOCKER_BRIDGE_POOL_LIMIT,
  DOCKER_DAEMON_JSON_PATH,
  formatBridgePoolBreakdown,
  LIST_BRIDGE_NETWORKS_COMMAND,
  parseBridgeNetworkNames,
  readDockerDaemonPools,
} from '../../lib/docker-bridge-pool.js';
import { isXBriefFilename } from '../../lib/xbrief/lifecycle.js';
// Minimum supported omp harness version (PAN-1989); its lineage differs from pi and was baselined at 16.1.16.
export const SUPPORTED_OMP_VERSION_MIN = '16.1.0';

const execAsync = promisify(exec);

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export async function checkKimi(
  probe?: PrerequisiteProbe,
  resolver?: PrerequisiteResolver,
): Promise<CheckResult[]> {
  const kimi = await checkSystemPrerequisite('kimi', probe, resolver);
  if (!kimi.found) {
    return [{
      name: kimi.name,
      status: 'warn',
      message: 'Not installed (optional ACP harness)',
      fix: `Install: ${kimi.install.linux}`,
    }];
  }

  return [{
    name: kimi.name,
    status: 'ok',
    message: kimi.version ?? 'Installed (version unknown)',
  }];
}

export function checkCodex(): CheckResult[] {
  if (!checkCommand('codex')) {
    return [
      {
        name: 'Codex CLI',
        status: 'warn',
        message: 'Not installed (optional alternative harness)',
        fix: 'Install: npm install -g @openai/codex',
      },
    ];
  }
  const version = readCodexVersion();
  return [
    {
      name: 'Codex CLI',
      status: 'ok',
      message: version ? `v${version}` : 'Installed (version unknown)',
    },
  ];
}

function readCodexVersion(): string | null {
  try {
    const out = execSync('codex --version 2>&1', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    const m = out.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function readOmpVersion(): string | null {
  // omp prints `omp/X.Y.Z` to stdout. Merge stderr for safety.
  try {
    const out = execSync('omp --version 2>&1', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    // Match `omp/X.Y.Z` or a bare semver.
    const m = out.match(/omp\/(\d+\.\d+\.\d+)/) ?? out.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function checkOhmypi(strict: boolean): CheckResult[] {
  const out: CheckResult[] = [];
  if (!checkCommand('omp')) {
    out.push({
      name: 'oh-my-pi (omp)',
      status: strict ? 'error' : 'warn',
      message: 'Not installed (ohmypi harness unavailable)',
      fix: 'Install: npm install -g @oh-my-pi/pi-coding-agent',
    });
    return out;
  }

  const version = readOmpVersion();
  if (!version) {
    out.push({
      name: 'oh-my-pi (omp)',
      status: 'warn',
      message: 'Detected but `omp --version` did not return a version string',
      fix: 'Reinstall: npm install -g @oh-my-pi/pi-coding-agent@latest',
    });
  } else if (compareSemver(version, SUPPORTED_OMP_VERSION_MIN) < 0) {
    out.push({
      name: 'oh-my-pi (omp)',
      status: strict ? 'error' : 'warn',
      message: `v${version} (too old — requires >= ${SUPPORTED_OMP_VERSION_MIN})`,
      fix: 'Upgrade: npm install -g @oh-my-pi/pi-coding-agent@latest',
    });
  } else {
    out.push({
      name: 'oh-my-pi (omp)',
      status: 'ok',
      message: `v${version}`,
    });
  }

  const extensionCandidates = ohmypiExtensionCandidates();
  const extensionPresent = extensionCandidates.some((p) => existsSync(p));
  if (!extensionPresent) {
    out.push({
      name: 'ohmypi Extension Bundle',
      status: 'warn',
      message: 'ohmypi extension bundle not found',
      fix: 'Build it: npm run build:ohmypi-extension && npm run build (or, in a checkout: cd packages/ohmypi-extension && npm run build)',
    });
  } else {
    out.push({
      name: 'ohmypi Extension Bundle',
      status: 'ok',
      message: 'ohmypi extension bundle present',
    });
  }

  // ChatGPT/Codex (openai-codex) OAuth used by GPT-5.x ohmypi conversations.
  // Only surfaced when a credential exists. Expiry is a sync read;
  // `pan ohmypi-auth status` does the live refresh check.
  const codexCred = readOhmypiCodexCredential();
  if (codexCred) {
    const mins = Math.round((codexCred.expires - Date.now()) / 60_000);
    if (mins > 1) {
      out.push({
        name: 'ohmypi ChatGPT/Codex auth',
        status: 'ok',
        message: `openai-codex token valid (${mins > 120 ? `~${Math.round(mins / 60)}h` : `~${mins}m`})`,
      });
    } else {
      out.push({
        name: 'ohmypi ChatGPT/Codex auth',
        status: 'warn',
        message: 'openai-codex token expired',
        fix: 'Refresh/re-auth: pan ohmypi-auth status (auto-refresh) or pan ohmypi-auth login',
      });
    }
  }
  return out;
}

export interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

function checkCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkDirectory(path: string): boolean {
  return existsSync(path);
}

interface ComposeDriftEntry {
  container: string;
  missingPath: string;
}

/**
 * Check whether any running Docker containers reference compose file paths
 * that no longer exist on disk (PAN-956). This happens when .devcontainer/
 * is deleted after containers were created, leaving orphaned containers with
 * stale com.docker.compose.project.config_files labels.
 */
function checkComposeLabelDrift(): ComposeDriftEntry[] {
  try {
    const output = execSync(
      `docker ps --format '{{.Names}}|{{.Label "com.docker.compose.project.config_files"}}'`,
      { encoding: 'utf-8', stdio: 'pipe' },
    );
    const drift: ComposeDriftEntry[] = [];
    for (const line of output.trim().split('\n').filter(Boolean)) {
      const sep = line.indexOf('|');
      if (sep === -1) continue;
      const containerName = line.slice(0, sep);
      const configFiles = line.slice(sep + 1);
      if (!configFiles) continue;
      for (const filePath of configFiles.split(',').map((s: string) => s.trim()).filter(Boolean)) {
        if (!existsSync(filePath)) {
          drift.push({ container: containerName, missingPath: filePath });
        }
      }
    }
    return drift;
  } catch {
    return [];
  }
}

export interface DuplicateStackContainerRow {
  name: string;
  composeProject?: string;
}

/**
 * PAN-3049: diagnose duplicate/mismatched Docker compose stacks per issue —
 * a workspace declaring `myn-feature-<issue>` but running (also, or only)
 * under the `overdeck-feature-<issue>` fallback. Read-only: stops nothing
 * itself, only reports what a human/agent should run.
 *
 * `resolveCanonicalProject` is injected so tests can exercise this without
 * touching Docker or the filesystem; the real doctor check resolves it via
 * `tryComposeProjectNameForWorkspace` + `defaultWorkspacePath`.
 */
export function diagnoseDuplicateComposeStacks(
  containers: DuplicateStackContainerRow[],
  resolveCanonicalProject: (issueId: string) => string | null,
): CheckResult[] {
  const projectsByIssue = new Map<string, Set<string>>();
  for (const container of containers) {
    if (!container.composeProject) continue;
    const issueId =
      inferIssueIdFromStackContainerName(container.composeProject) ??
      inferIssueIdFromStackContainerName(container.name);
    if (!issueId) continue;
    const projects = projectsByIssue.get(issueId) ?? new Set<string>();
    projects.add(container.composeProject);
    projectsByIssue.set(issueId, projects);
  }

  const results: CheckResult[] = [];
  for (const issueId of [...projectsByIssue.keys()].sort()) {
    const runningProjects = [...projectsByIssue.get(issueId)!].sort();
    const canonical = resolveCanonicalProject(issueId);

    if (runningProjects.length === 1) {
      // Healthy: the single running stack IS the canonical one. Silent.
      if (canonical && runningProjects[0] === canonical) continue;
      // Unresolvable canonical — nothing to safely compare against. Silent.
      if (!canonical) continue;

      const onlyName = runningProjects[0];
      results.push({
        name: `Duplicate Docker stack (${issueId})`,
        status: 'warn',
        message: `${issueId}'s only running stack is ${onlyName}, not its canonical name ${canonical}`,
        fix: `Stack runs under non-canonical name ${onlyName} and may be serving a live agent — run \`pan workspace rebuild ${issueId}\` and only stop ${onlyName} after the canonical stack is healthy.`,
      });
      continue;
    }

    // ≥2 distinct running compose projects for the same issue — a duplicate.
    const foreign = runningProjects.filter((project) => project !== canonical);
    results.push({
      name: `Duplicate Docker stack (${issueId})`,
      status: 'warn',
      message: canonical
        ? `${issueId} has ${runningProjects.length} running compose projects (canonical: ${canonical}): ${runningProjects.join(', ')}`
        : `${issueId} has ${runningProjects.length} running compose projects: ${runningProjects.join(', ')}`,
      fix: foreign.length > 0
        ? foreign.map((name) => `foreign stack ${name} is a duplicate: docker compose -p "${name}" down`).join('\n')
        : undefined,
    });
  }

  return results;
}

function resolveCanonicalComposeProjectForDoctor(issueId: string): string | null {
  const resolvedProject = resolveProjectFromIssueSync(issueId);
  const projectConfig = resolvedProject ? getProjectSync(resolvedProject.projectKey) : null;
  const workspacePath = defaultWorkspacePath(issueId, projectConfig);
  return tryComposeProjectNameForWorkspace(workspacePath, issueId);
}

export async function checkDuplicateComposeStacks(): Promise<CheckResult[]> {
  if (!checkCommand('docker')) return [];
  try {
    const { stdout } = await execAsync(
      `docker ps --format '{{.Names}}\t{{.Label "com.docker.compose.project"}}'`,
    );
    const containers: DuplicateStackContainerRow[] = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, composeProject] = line.split('\t');
        return { name, composeProject: composeProject || undefined };
      });
    return diagnoseDuplicateComposeStacks(containers, resolveCanonicalComposeProjectForDoctor);
  } catch {
    return [];
  }
}

/**
 * PAN-2510 / PAN-3053: warn when the host's bridge networks are close to
 * exhausting Docker's address pools, or when /etc/docker/daemon.json lacks a
 * wider default-address-pools configuration. Advisory only — we never edit
 * daemon.json.
 *
 * The count is host-wide (PAN-3053). Every bridge network consumes a pool slot
 * whatever its name, so filtering to `overdeck-feature-*_devnet` reported
 * healthy at 100% exhaustion while every workspace rebuild failed.
 */
const DAEMON_JSON_PATH = DOCKER_DAEMON_JSON_PATH;

const DEFAULT_ADDRESS_POOLS_SNIPPET = `{
  "default-address-pools": [
    { "base": "10.200.0.0/16", "size": 24 }
  ]
}`;

export async function checkDockerBridgeNetworkPool(): Promise<CheckResult[]> {
  if (!checkCommand('docker')) {
    return [];
  }

  const [networkResult, pools] = await Promise.all([
    execAsync(LIST_BRIDGE_NETWORKS_COMMAND).catch(() => ({ stdout: '' })),
    readDockerDaemonPools(),
  ]);

  const names = parseBridgeNetworkNames(networkResult.stdout);
  const pressure = assessBridgePoolPressure(
    names,
    bridgePoolLimitFromPools(pools) ?? DEFAULT_DOCKER_BRIDGE_POOL_LIMIT,
  );
  const breakdown = formatBridgePoolBreakdown(pressure.groups);
  const detail = breakdown ? ` (${breakdown})` : '';
  const results: CheckResult[] = [];

  if (pressure.underPressure) {
    results.push({
      name: 'Docker bridge network pool',
      status: pressure.exhausted ? 'error' : 'warn',
      message: pressure.exhausted
        ? `${pressure.total} bridge networks against a ~${pressure.limit}-network pool — new workspace stacks cannot be created${detail}`
        : `${pressure.total} of ~${pressure.limit} bridge network slots used, ${pressure.headroom} left${detail}`,
      fix: `Remove orphaned workspace networks, or widen the pool by adding default-address-pools to ${DAEMON_JSON_PATH} and restarting Docker:\n${DEFAULT_ADDRESS_POOLS_SNIPPET}`,
    });
  }

  if (pools === null) {
    results.push({
      name: 'Docker default-address-pools',
      status: 'warn',
      message: `${DAEMON_JSON_PATH} does not declare default-address-pools`,
      fix: `Add a wider pool to ${DAEMON_JSON_PATH} and restart Docker:\n${DEFAULT_ADDRESS_POOLS_SNIPPET}`,
    });
  }

  if (results.length === 0) {
    results.push({
      name: 'Docker bridge network pool',
      status: 'ok',
      message: `${pressure.total} of ~${pressure.limit} bridge network slots used${detail}`,
    });
  }

  return results;
}

function countItems(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    return readdirSync(path).length;
  } catch {
    return 0;
  }
}

function getCachedIssueRowsForDoctor(): unknown[] {
  try {
    const cache = new CacheService();
    return ['github', 'linear', 'rally'].flatMap((tracker) => {
      const entry = cache.getStale(tracker, 'issues');
      return Array.isArray(entry?.data) ? entry.data : [];
    });
  } catch {
    return [];
  }
}

export function checkTrackerRateLimits(): CheckResult {
  let cache: CacheService | undefined;
  try {
    cache = new CacheService();
    const trackers = ['github', 'linear', 'rally'] as const;
    const warnings: string[] = [];

    for (const tracker of trackers) {
      const suspendMs = cache.getSuspensionMs(tracker);
      if (suspendMs > 0) {
        const limit = cache.getRateLimit(tracker);
        const resetTime = limit?.resetAt ? new Date(limit.resetAt).toISOString() : 'unknown';
        warnings.push(`${tracker} suspended until ${resetTime}`);
      } else if (cache.shouldBackoff(tracker)) {
        warnings.push(`${tracker} backing off`);
      }
    }

    if (warnings.length > 0) {
      return {
        name: 'Tracker Rate Limits',
        status: 'warn',
        message: warnings.join('; '),
      };
    }

    return {
      name: 'Tracker Rate Limits',
      status: 'ok',
      message: 'All trackers within rate limits',
    };
  } catch (err: any) {
    return {
      name: 'Tracker Rate Limits',
      status: 'ok',
      message: `Skipped (${err.message})`,
    };
  } finally {
    cache?.close();
  }
}

export async function checkClosedIssueOrphanAgentDirs(
  issues: unknown[],
  agentsDir: string = AGENTS_DIR,
): Promise<CheckResult> {
  const result = await Effect.runPromise(cleanupClosedIssueAgentDirectories({
    issues,
    agentsDir,
    dryRun: true,
  }));

  if (result.totalCandidates === 0) {
    return {
      name: 'Closed-Issue Agent Dirs',
      status: 'ok',
      message: 'No old closed-issue agent dirs detected',
    };
  }

  const removable = result.wouldRemove.slice(0, 8).join(', ');
  const protectedDirs = result.protected.slice(0, 8).join(', ');
  const details = [
    result.wouldRemove.length > 0 ? `removable: ${removable}` : null,
    result.protected.length > 0 ? `protected: ${protectedDirs}` : null,
  ].filter(Boolean).join('; ');

  return {
    name: 'Closed-Issue Agent Dirs',
    status: 'warn',
    message: `${result.totalCandidates} old closed-issue agent dir${result.totalCandidates === 1 ? '' : 's'} detected`,
    fix: details
      ? `Restart pan up to run the startup sweep. ${details}`
      : 'Restart pan up to run the startup sweep.',
  };
}

type DoctorAgentState = {
  id?: unknown;
  issueId?: unknown;
  status?: unknown;
  startedAt?: unknown;
  lastActivity?: unknown;
};

type DoctorDashboardAgent = {
  id?: unknown;
  issueId?: unknown;
  status?: unknown;
  startedAt?: unknown;
  lastActivity?: unknown;
  hasLiveTmuxSession?: unknown;
};

function normalizeDoctorAgentId(agentId: string): string {
  // PAN-1760: route through normalizeAgentId so strike-/inspect- prefixed
  // agents and singleton IDs aren't blindly re-prefixed with 'agent-'.
  return normalizeAgentId(agentId);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readDoctorAgentStates(agentsDir: string): DoctorAgentState[] {
  if (!existsSync(agentsDir)) return [];

  const states: DoctorAgentState[] = [];
  for (const dir of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    try {
      const state = getAgentStateSync(dir.name);
      if (state) states.push(state);
    } catch {
      // Ignore unreadable agent state; other doctor checks surface broader FS health.
    }
  }
  return states;
}

async function getDashboardAgentRowsForDoctor(): Promise<DoctorDashboardAgent[] | null> {
  try {
    const response = await fetch(`${getDashboardApiUrlSync().replace(/\/$/, '')}/api/agents`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data) ? data as DoctorDashboardAgent[] : null;
  } catch {
    return null;
  }
}

export function checkStoppedListClassification(options: {
  agentsDir?: string;
  dashboardAgents: DoctorDashboardAgent[] | null;
  tmuxSessionNames?: string[];
  nowMs?: number;
}): CheckResult {
  const agentsDir = options.agentsDir ?? AGENTS_DIR;
  const tmuxSessionNames = options.tmuxSessionNames
    ?? getAgentSessionsSync().map((session) => session.name);
  const tmuxSessions = new Set(tmuxSessionNames);
  const liveRunningAgents = readDoctorAgentStates(agentsDir).filter((state) => {
    const id = stringField(state.id);
    return state.status === 'running' && id && tmuxSessions.has(normalizeDoctorAgentId(id));
  });

  if (liveRunningAgents.length === 0) {
    return {
      name: 'Stopped-List Classification',
      status: 'ok',
      message: 'No running agent state disagrees with tmux liveness',
    };
  }

  if (options.dashboardAgents === null) {
    return {
      name: 'Stopped-List Classification',
      status: 'warn',
      message: 'Dashboard /api/agents unavailable; could not verify stopped-list classification',
      fix: 'Start pan up and rerun pan doctor. PAN-1419 guards running+tmux agents from stopped lists.',
    };
  }

  const dashboardById = new Map(
    options.dashboardAgents
      .map((agent) => [stringField(agent.id), agent] as const)
      .filter((entry): entry is readonly [string, DoctorDashboardAgent] => entry[0] !== undefined),
  );
  const misclassified: string[] = [];

  for (const state of liveRunningAgents) {
    const id = normalizeDoctorAgentId(stringField(state.id)!);
    const dashboardAgent = dashboardById.get(id);
    if (!dashboardAgent) {
      misclassified.push(id);
      continue;
    }

    const issueId = stringField(dashboardAgent.issueId) ?? stringField(state.issueId);
    const status = stringField(dashboardAgent.status);
    if (!issueId || !status) {
      misclassified.push(id);
      continue;
    }

    const classification = classifyDashboardAgent({
      issueId,
      status: status as AgentStatus,
      hasLiveTmuxSession: typeof dashboardAgent.hasLiveTmuxSession === 'boolean'
        ? dashboardAgent.hasLiveTmuxSession
        : undefined,
      lastActivity: stringField(dashboardAgent.lastActivity),
      startedAt: stringField(dashboardAgent.startedAt) ?? stringField(state.startedAt),
    }, options.nowMs);

    if (classification !== 'active') {
      misclassified.push(id);
    }
  }

  if (misclassified.length === 0) {
    return {
      name: 'Stopped-List Classification',
      status: 'ok',
      message: 'Running agents with live tmux classify as active',
    };
  }

  return {
    name: 'Stopped-List Classification',
    status: 'warn',
    message: `${misclassified.length} running agent${misclassified.length === 1 ? '' : 's'} with live tmux would not classify as active: ${misclassified.join(', ')}`,
    fix: 'PAN-1419: ensure /api/agents and read-model snapshots preserve hasLiveTmuxSession for live tmux agents.',
  };
}

type OrphanProposedSpecReason = 'no-agent-no-reason';

type DoctorProjectEntry = { key: string; config: Pick<ProjectConfig, 'name' | 'path'> };

export interface OrphanProposedSpec {
  projectKey: string;
  projectName: string;
  issueId: string;
  reason: OrphanProposedSpecReason;
  planItemCount: number;
}

function normalizeDoctorIssueId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z]+-\d+$/.test(value.trim())
    ? value.trim().toUpperCase()
    : null;
}

function readJsonFile(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function hasInFlightAgent(issueId: string, _agentsDir: string, tmuxSessionNames: string[]): boolean {
  const agentId = `agent-${issueId.toLowerCase()}`;
  if (tmuxSessionNames.includes(agentId)) return true;

  const state = getAgentStateSync(agentId);
  return state?.status === 'starting' || state?.status === 'running';
}

export function findOrphanProposedSpecs(options: {
  projects?: DoctorProjectEntry[];
  agentsDir?: string;
  tmuxSessionNames?: string[];
} = {}): OrphanProposedSpec[] {
  const projects = options.projects ?? listProjectsSync();
  const agentsDir = options.agentsDir ?? AGENTS_DIR;
  const tmuxSessionNames = options.tmuxSessionNames ?? (() => {
    try { return listSessionNamesSync(); } catch { return []; }
  })();
  const orphans: OrphanProposedSpec[] = [];

  for (const { key, config } of projects) {
    const specsDir = join(config.path, '.pan', 'specs');
    if (!existsSync(specsDir)) continue;

    for (const entry of readdirSync(specsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !isXBriefFilename(entry.name)) continue;
      const spec = readJsonFile(join(specsDir, entry.name));
      if (spec?.plan?.status !== 'proposed') continue;
      const issueId = normalizeDoctorIssueId(spec.plan?.id);
      if (!issueId || hasInFlightAgent(issueId, agentsDir, tmuxSessionNames)) continue;

      const planItemCount = Array.isArray(spec.plan?.items) ? spec.plan.items.length : 0;
      const reason: OrphanProposedSpecReason = 'no-agent-no-reason';
      orphans.push({
        projectKey: key,
        projectName: config.name,
        issueId,
        reason,
        planItemCount,
      });
    }
  }

  return orphans;
}

function orphanProposedHint(reason: OrphanProposedSpecReason): string {
  return 'retry spawn with `pan start <id>` after checking stack health; use `--host` only for an explicit operator bypass';
}

export function checkOrphanProposedSpecs(options: {
  projects?: DoctorProjectEntry[];
  agentsDir?: string;
  tmuxSessionNames?: string[];
} = {}): CheckResult {
  const orphans = findOrphanProposedSpecs(options);
  if (orphans.length === 0) {
    return {
      name: 'orphan-proposed-specs',
      status: 'ok',
      message: 'No proposed specs without matching work agents detected',
    };
  }

  const grouped = new Map<string, OrphanProposedSpec[]>();
  for (const orphan of orphans) {
    const key = `${orphan.projectKey} (${orphan.projectName})`;
    grouped.set(key, [...(grouped.get(key) ?? []), orphan]);
  }

  const summary = [...grouped.entries()]
    .map(([project, items]) => `${project}: ${items.map((item) => `${item.issueId} ${item.reason} (${item.planItemCount} plan items)`).join(', ')}`)
    .join('; ');
  const fixes = [...new Set(orphans.map((orphan) => `${orphan.reason}: ${orphanProposedHint(orphan.reason)}`))];

  return {
    name: 'orphan-proposed-specs',
    status: 'warn',
    message: `${orphans.length} orphan proposed spec${orphans.length === 1 ? '' : 's'} detected by project: ${summary}`,
    fix: fixes.join('\n  '),
  };
}

export async function checkMainDivergence(
  projects: DoctorProjectEntry[] = listProjectsSync(),
  measure: (repoPath: string) => Promise<MainDivergence> = getMainDivergence,
): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  for (const project of projects) {
    const projectPath = project.config.path;
    const projectLabel = `${project.key} (${project.config.name})`;
    const divergence = await measure(projectPath);
    const status = divergence.ahead > 1 || divergence.behind > 0 ? 'warn' : 'ok';
    checks.push({
      name: `Main Divergence: ${projectLabel}`,
      status,
      message: `local main ahead ${divergence.ahead}, behind ${divergence.behind} relative to origin/main`,
      fix: status === 'warn'
        ? 'Push state commits with `git push origin main`; pan reload builds from origin/main, so stale origin/main can deploy stale code.'
        : undefined,
    });
  }

  return checks;
}

export interface DoctorOptions {
  strict?: boolean;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  console.log(chalk.bold('\nOverdeck Doctor\n'));
  console.log(chalk.dim('Checking system health...\n'));

  const checks: CheckResult[] = [];

  // Check required commands
  const requiredCommands = [
    { cmd: 'git', name: 'Git', fix: 'Install git' },
    { cmd: 'tmux', name: 'tmux', fix: 'Install tmux: apt install tmux / brew install tmux' },
    { cmd: 'node', name: 'Node.js', fix: 'Install Node.js 18+' },
    { cmd: 'claude', name: 'Claude CLI', fix: 'Install: npm install -g @anthropic-ai/claude-code' },
  ];

  for (const { cmd, name, fix } of requiredCommands) {
    if (checkCommand(cmd)) {
      checks.push({ name, status: 'ok', message: 'Installed' });
    } else {
      checks.push({ name, status: 'error', message: 'Not found', fix });
    }
  }

  // Check optional commands
  const optionalCommands = [
    { cmd: 'gh', name: 'GitHub CLI', fix: 'Install: gh auth login' },
    { cmd: 'docker', name: 'Docker', fix: 'Install Docker for workspace containers' },
  ];

  for (const { cmd, name, fix } of optionalCommands) {
    if (checkCommand(cmd)) {
      checks.push({ name, status: 'ok', message: 'Installed' });
    } else {
      checks.push({ name, status: 'warn', message: 'Not installed (optional)', fix });
    }
  }

  // oh-my-pi / omp (ohmypi harness — PAN-1989, replaces pi PAN-636).
  // omp is optional: missing → warn (or error under --strict). When installed, version
  // is compared against SUPPORTED_OMP_VERSION_MIN and the bundled extension is checked.
  for (const c of checkOhmypi(options.strict ?? false)) checks.push(c);

  // Codex CLI (alternative harness — PAN-1574). Optional: missing → warn.
  for (const c of checkCodex()) checks.push(c);

  // Kimi Code CLI (ACP harness). Resolve the same configured executable used at launch.
  for (const c of await checkKimi()) checks.push(c);

  // Check Overdeck directories
  const directories = [
    { path: OVERDECK_HOME, name: 'Overdeck Home', fix: 'Run: pan init' },
    { path: SKILLS_DIR, name: 'Skills Directory', fix: 'Run: pan init' },
    { path: COMMANDS_DIR, name: 'Commands Directory', fix: 'Run: pan init' },
    { path: AGENTS_DIR, name: 'Agents Directory', fix: 'Run: pan init' },
  ];

  for (const { path, name, fix } of directories) {
    if (checkDirectory(path)) {
      const count = countItems(path);
      checks.push({ name, status: 'ok', message: `Exists (${count} items)` });
    } else {
      checks.push({ name, status: 'error', message: 'Missing', fix });
    }
  }

  // Check Claude Code integration
  if (checkDirectory(CLAUDE_DIR)) {
    const skillsCount = countItems(join(CLAUDE_DIR, 'skills'));
    const commandsCount = countItems(join(CLAUDE_DIR, 'commands'));
    checks.push({
      name: 'Claude Code Skills',
      status: skillsCount > 0 ? 'ok' : 'warn',
      message: `${skillsCount} skills`,
      fix: skillsCount === 0 ? 'Run: pan sync' : undefined,
    });
    checks.push({
      name: 'Claude Code Commands',
      status: commandsCount > 0 ? 'ok' : 'warn',
      message: `${commandsCount} commands`,
      fix: commandsCount === 0 ? 'Run: pan sync' : undefined,
    });
  } else {
    checks.push({
      name: 'Claude Code Directory',
      status: 'warn',
      message: 'Not found',
      fix: 'Install Claude Code first',
    });
  }

  // Check environment variables
  const envFile = join(homedir(), '.overdeck.env');
  if (existsSync(envFile)) {
    checks.push({ name: 'Config File', status: 'ok', message: '~/.overdeck.env exists' });
  } else {
    checks.push({
      name: 'Config File',
      status: 'warn',
      message: '~/.overdeck.env not found',
      fix: 'Create ~/.overdeck.env with LINEAR_API_KEY=...',
    });
  }

  // Check for LINEAR_API_KEY
  if (process.env.LINEAR_API_KEY) {
    checks.push({ name: 'LINEAR_API_KEY', status: 'ok', message: 'Set in environment' });
  } else if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    if (content.includes('LINEAR_API_KEY')) {
      checks.push({ name: 'LINEAR_API_KEY', status: 'ok', message: 'Set in config file' });
    } else {
      checks.push({
        name: 'LINEAR_API_KEY',
        status: 'warn',
        message: 'Not configured',
        fix: 'Add LINEAR_API_KEY to ~/.overdeck.env',
      });
    }
  } else {
    checks.push({
      name: 'LINEAR_API_KEY',
      status: 'warn',
      message: 'Not configured',
      fix: 'Set LINEAR_API_KEY environment variable or add to ~/.overdeck.env',
    });
  }

  // Check tmux sessions
  try {
    const agentSessions = listSessionNamesSync().filter((s) => s.includes('agent-')).length;
    checks.push({
      name: 'Running Agents',
      status: 'ok',
      message: `${agentSessions} agent sessions`,
    });
  } catch {
    checks.push({
      name: 'Running Agents',
      status: 'ok',
      message: '0 agent sessions',
    });
  }

  checks.push(await checkClosedIssueOrphanAgentDirs(getCachedIssueRowsForDoctor()));
  checks.push(checkTrackerRateLimits());
  checks.push(checkStoppedListClassification({
    dashboardAgents: await getDashboardAgentRowsForDoctor(),
  }));
  checks.push(checkOrphanProposedSpecs());
  checks.push(...await checkMainDivergence());
  checks.push(...await checkStateWorktrees());
  try {
    const { isSmeeProcessRunningSync } = await import('../../lib/smee.js');
    const smeeUrlPath = join(homedir(), '.overdeck', 'github-app', 'smee-url');
    if (!existsSync(smeeUrlPath)) {
      checks.push({
        name: 'smee-client Webhook Relay',
        status: 'warn',
        message: 'Not configured (optional)',
        fix: 'Create ~/.overdeck/github-app/smee-url with your smee.io channel URL',
      });
    } else if (isSmeeProcessRunningSync()) {
      checks.push({
        name: 'smee-client Webhook Relay',
        status: 'ok',
        message: 'Running',
      });
    } else {
      checks.push({
        name: 'smee-client Webhook Relay',
        status: 'warn',
        message: 'Configured but not running',
        fix: 'Run `pan up` to start the webhook relay',
      });
    }
  } catch {
    checks.push({
      name: 'smee-client Webhook Relay',
      status: 'warn',
      message: 'Status check failed',
    });
  }

  // Check Docker compose label drift (PAN-956)
  if (checkCommand('docker')) {
    const drift = checkComposeLabelDrift();
    if (drift.length === 0) {
      checks.push({
        name: 'Docker Compose Labels',
        status: 'ok',
        message: 'No compose path drift detected',
      });
    } else {
      const details = drift.map((d) => `${d.container}: ${d.missingPath}`).join('; ');
      checks.push({
        name: 'Docker Compose Labels',
        status: 'warn',
        message: `${drift.length} container(s) reference missing compose path(s)`,
        fix: `Re-render .devcontainer/ for affected workspaces, then restart containers. Drift: ${details}`,
      });
    }
  }

  // Check Docker devnet network pool exhaustion (PAN-2510)
  for (const c of await checkDockerBridgeNetworkPool()) checks.push(c);

  // Check for duplicate/mismatched compose stacks per issue (PAN-3049)
  for (const c of await checkDuplicateComposeStacks()) checks.push(c);

  // Check inotify watch budget and persistence (PAN-3063)
  for (const c of await checkInotify()) checks.push(c);

  // Check for legacy command invocations in shell rc files (PAN-705)
  const legacyPatterns = [
    'pan work ',
    'pan plan-finalize',
    'pan admin hooks install',
    'pan sync-costs',
    'pan cloister ',
    'pan specialists ',
    'pan admin migrate-config',
  ];
  const shellRcFiles = [
    join(homedir(), '.bashrc'),
    join(homedir(), '.bash_profile'),
    join(homedir(), '.zshrc'),
    join(homedir(), '.profile'),
    join(homedir(), '.bash_aliases'),
  ].filter(existsSync);

  const legacyFound: string[] = [];
  for (const rcFile of shellRcFiles) {
    try {
      const content = readFileSync(rcFile, 'utf-8');
      for (const pattern of legacyPatterns) {
        if (content.includes(pattern)) {
          legacyFound.push(`${rcFile.replace(homedir(), '~')} contains "${pattern}"`);
        }
      }
    } catch { /* ignore unreadable files */ }
  }

  if (legacyFound.length === 0) {
    checks.push({
      name: 'Legacy Command Aliases',
      status: 'ok',
      message: 'No legacy pan work/* aliases found in shell config',
    });
  } else {
    checks.push({
      name: 'Legacy Command Aliases',
      status: 'warn',
      message: `Found ${legacyFound.length} legacy command reference(s) in shell config`,
      fix: `Update the following to use 0.7.0 commands (see pan --help or QUICK-REFERENCE.md):\n  ${legacyFound.join('\n  ')}`,
    });
  }

  // Print results
  const icons = {
    ok: chalk.green('\u2713'),
    warn: chalk.yellow('\u26a0'),
    error: chalk.red('\u2717'),
  };

  let hasErrors = false;
  let hasWarnings = false;

  for (const check of checks) {
    const icon = icons[check.status];
    const message = check.status === 'error' ? chalk.red(check.message) :
                    check.status === 'warn' ? chalk.yellow(check.message) :
                    chalk.dim(check.message);

    console.log(`${icon} ${check.name}: ${message}`);

    if (check.fix && check.status !== 'ok') {
      console.log(chalk.dim(`  Fix: ${check.fix}`));
    }

    if (check.status === 'error') hasErrors = true;
    if (check.status === 'warn') hasWarnings = true;
  }

  console.log('');

  if (hasErrors) {
    console.log(chalk.red('Some required components are missing.'));
    console.log(chalk.dim('Fix the errors above before using Overdeck.'));
  } else if (hasWarnings) {
    console.log(chalk.yellow('System is functional with some optional features missing.'));
  } else {
    console.log(chalk.green('All systems operational!'));
  }
  console.log('');

  if (hasErrors) {
    return exitCli(1);
  }
  if (options.strict && hasWarnings) {
    return exitCli(1);
  }
}
