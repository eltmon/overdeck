import chalk from 'chalk';
import { Effect } from 'effect';
import type { AgentStatus } from '@panctl/contracts';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { getAgentSessionsSync, listSessionNamesSync } from '../../lib/tmux.js';
import { listProjectsSync, type ProjectConfig } from '../../lib/projects.js';
import { homedir } from 'os';
import { join } from 'path';
import {
  PANOPTICON_HOME,
  SKILLS_DIR,
  COMMANDS_DIR,
  AGENTS_DIR,
  CLAUDE_DIR,
  packageRoot,
} from '../../lib/paths.js';
import { cleanupClosedIssueAgentDirectories } from '../../lib/agent-directory-cleanup.js';
import { getDashboardApiUrlSync } from '../../lib/config.js';
import { CacheService } from '../../dashboard/server/services/cache-service.js';
import { classifyDashboardAgent } from '../../dashboard/frontend/src/lib/agent-classifier.js';

// Minimum supported Pi binary version for the Pi harness (PAN-636).
// Bump in lockstep with packages/pi-extension API surface compatibility.
export const SUPPORTED_PI_VERSION_MIN = '0.73.0';

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

export function checkPi(strict: boolean): CheckResult[] {
  const out: CheckResult[] = [];
  if (!checkCommand('pi')) {
    out.push({
      name: 'Pi Coding Agent',
      status: strict ? 'error' : 'warn',
      message: 'Not installed (optional alternative harness)',
      fix: 'Install: npm install -g @mariozechner/pi-coding-agent',
    });
    return out;
  }

  const version = readPiVersion();
  if (!version) {
    out.push({
      name: 'Pi Coding Agent',
      status: 'warn',
      message: 'Detected but `pi --version` did not return a version string',
      fix: 'Reinstall: npm install -g @mariozechner/pi-coding-agent',
    });
  } else if (compareSemver(version, SUPPORTED_PI_VERSION_MIN) < 0) {
    out.push({
      name: 'Pi Coding Agent',
      status: 'error',
      message: `v${version} (too old — requires >= ${SUPPORTED_PI_VERSION_MIN})`,
      fix: 'Upgrade: npm install -g @mariozechner/pi-coding-agent@latest',
    });
  } else {
    out.push({
      name: 'Pi Coding Agent',
      status: 'ok',
      message: `v${version}`,
    });
  }

  const extensionDist = join(packageRoot, 'packages', 'pi-extension', 'dist', 'index.js');
  if (!existsSync(extensionDist)) {
    out.push({
      name: 'Pi Extension Bundle',
      status: 'warn',
      message: 'packages/pi-extension/dist/index.js not found',
      fix: 'Build it: cd packages/pi-extension && npm run build',
    });
  } else {
    out.push({
      name: 'Pi Extension Bundle',
      status: 'ok',
      message: 'packages/pi-extension/dist/index.js present',
    });
  }
  return out;
}

function readPiVersion(): string | null {
  // Pi prints its version to stderr, not stdout — merge both streams.
  try {
    const out = execSync('pi --version 2>&1', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    const m = out.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
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

export async function checkGraphifyFreshness(projectPath: string): Promise<CheckResult | null> {
  const summaryPath = join(projectPath, 'graphify-out', 'GRAPH_SUMMARY.md');
  if (!existsSync(summaryPath)) {
    return null;
  }

  let headTimeMs: number;
  try {
    const { stdout } = await execAsync('git log -1 --format=%ct', { cwd: projectPath, encoding: 'utf-8' });
    headTimeMs = Number(stdout.trim()) * 1000;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: 'Graphify graph freshness',
      status: 'warn',
      message: `Could not read HEAD timestamp: ${message}`,
      fix: `Run: git status from ${projectPath}`,
    };
  }

  if (!Number.isFinite(headTimeMs)) {
    return {
      name: 'Graphify graph freshness',
      status: 'warn',
      message: 'Could not parse HEAD timestamp',
      fix: `Run: git log -1 --format=%ct from ${projectPath}`,
    };
  }

  const summaryMtimeMs = statSync(summaryPath).mtimeMs;
  if (summaryMtimeMs >= headTimeMs) {
    return {
      name: 'Graphify graph freshness',
      status: 'ok',
      message: 'Fresh — updated since HEAD',
    };
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(1, Math.ceil((headTimeMs - summaryMtimeMs) / dayMs));
  return {
    name: 'Graphify graph freshness',
    status: 'warn',
    message: `Stale — ${days} day${days === 1 ? '' : 's'} older than HEAD`,
    fix: `Run: graphify update . from ${projectPath}; or wait for the next merge to refresh automatically`,
  };
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
  return /^(agent|planning|conv)-/.test(agentId) ? agentId : `agent-${agentId.toLowerCase()}`;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readDoctorAgentStates(agentsDir: string): DoctorAgentState[] {
  if (!existsSync(agentsDir)) return [];

  const states: DoctorAgentState[] = [];
  for (const dir of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const statePath = join(agentsDir, dir.name, 'state.json');
    if (!existsSync(statePath)) continue;
    try {
      const state = JSON.parse(readFileSync(statePath, 'utf8')) as DoctorAgentState;
      states.push({ ...state, id: stringField(state.id) ?? dir.name });
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

type OrphanProposedSpecReason = 'beads-zero' | 'beads-mismatch' | 'no-agent-no-reason';

type DoctorProjectEntry = { key: string; config: Pick<ProjectConfig, 'name' | 'path'> };

export interface OrphanProposedSpec {
  projectKey: string;
  projectName: string;
  issueId: string;
  reason: OrphanProposedSpecReason;
  beadCount: number;
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

function countBeadsForIssue(projectPath: string, issueId: string): number {
  const beadsPath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`, '.beads', 'issues.jsonl');
  if (!existsSync(beadsPath)) return 0;
  try {
    return readFileSync(beadsPath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .filter((line) => {
        try {
          const record = JSON.parse(line) as { _type?: unknown; labels?: unknown };
          return record._type === 'issue'
            && Array.isArray(record.labels)
            && record.labels.some((label) => typeof label === 'string' && label.toLowerCase() === issueId.toLowerCase());
        } catch {
          return false;
        }
      }).length;
  } catch {
    return 0;
  }
}

function hasInFlightAgent(issueId: string, agentsDir: string, tmuxSessionNames: string[]): boolean {
  const agentId = `agent-${issueId.toLowerCase()}`;
  if (tmuxSessionNames.includes(agentId)) return true;

  const statePath = join(agentsDir, agentId, 'state.json');
  const state = existsSync(statePath) ? readJsonFile(statePath) as DoctorAgentState | null : null;
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
      if (!entry.isFile() || !entry.name.endsWith('.vbrief.json')) continue;
      const spec = readJsonFile(join(specsDir, entry.name));
      if (spec?.plan?.status !== 'proposed') continue;
      const issueId = normalizeDoctorIssueId(spec.plan?.id);
      if (!issueId || hasInFlightAgent(issueId, agentsDir, tmuxSessionNames)) continue;

      const planItemCount = Array.isArray(spec.plan?.items) ? spec.plan.items.length : 0;
      const beadCount = countBeadsForIssue(config.path, issueId);
      const reason: OrphanProposedSpecReason = beadCount === 0
        ? 'beads-zero'
        : beadCount !== planItemCount
          ? 'beads-mismatch'
          : 'no-agent-no-reason';
      orphans.push({
        projectKey: key,
        projectName: config.name,
        issueId,
        reason,
        beadCount,
        planItemCount,
      });
    }
  }

  return orphans;
}

function orphanProposedHint(reason: OrphanProposedSpecReason): string {
  switch (reason) {
    case 'beads-zero':
      return 'free disk if needed, then re-run planning so beads are materialized before promotion';
    case 'beads-mismatch':
      return 're-run planning or inspect bd errors; spec items and bead tasks diverged';
    case 'no-agent-no-reason':
      return 'retry spawn with `pan start <id>` after checking stack health; use `--host` only for an explicit operator bypass';
  }
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
    .map(([project, items]) => `${project}: ${items.map((item) => `${item.issueId} ${item.reason} (${item.beadCount}/${item.planItemCount} beads)`).join(', ')}`)
    .join('; ');
  const fixes = [...new Set(orphans.map((orphan) => `${orphan.reason}: ${orphanProposedHint(orphan.reason)}`))];

  return {
    name: 'orphan-proposed-specs',
    status: 'warn',
    message: `${orphans.length} orphan proposed spec${orphans.length === 1 ? '' : 's'} detected by project: ${summary}`,
    fix: fixes.join('\n  '),
  };
}

export interface DoctorOptions {
  strict?: boolean;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  console.log(chalk.bold('\nPanopticon Doctor\n'));
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
    { cmd: 'bd', name: 'Beads CLI', fix: 'Install beads for task tracking' },
    { cmd: 'docker', name: 'Docker', fix: 'Install Docker for workspace containers' },
  ];

  for (const { cmd, name, fix } of optionalCommands) {
    if (checkCommand(cmd)) {
      checks.push({ name, status: 'ok', message: 'Installed' });
    } else {
      checks.push({ name, status: 'warn', message: 'Not installed (optional)', fix });
    }
  }

  // Pi Coding Agent (alternative harness — PAN-636).
  // Pi is optional: missing → warn (or error under --strict). When installed, version
  // is compared against SUPPORTED_PI_VERSION_MIN and the bundled extension is checked.
  for (const c of checkPi(options.strict ?? false)) checks.push(c);

  // Check Panopticon directories
  const directories = [
    { path: PANOPTICON_HOME, name: 'Panopticon Home', fix: 'Run: pan init' },
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
  const envFile = join(homedir(), '.panopticon.env');
  if (existsSync(envFile)) {
    checks.push({ name: 'Config File', status: 'ok', message: '~/.panopticon.env exists' });
  } else {
    checks.push({
      name: 'Config File',
      status: 'warn',
      message: '~/.panopticon.env not found',
      fix: 'Create ~/.panopticon.env with LINEAR_API_KEY=...',
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
        fix: 'Add LINEAR_API_KEY to ~/.panopticon.env',
      });
    }
  } else {
    checks.push({
      name: 'LINEAR_API_KEY',
      status: 'warn',
      message: 'Not configured',
      fix: 'Set LINEAR_API_KEY environment variable or add to ~/.panopticon.env',
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
  checks.push(checkStoppedListClassification({
    dashboardAgents: await getDashboardAgentRowsForDoctor(),
  }));
  checks.push(checkOrphanProposedSpecs());

  // Check smee-client webhook relay
  try {
    const { isSmeeProcessRunningSync } = await import('../../lib/smee.js');
    const smeeUrlPath = join(homedir(), '.panopticon', 'github-app', 'smee-url');
    if (!existsSync(smeeUrlPath)) {
      checks.push({
        name: 'smee-client Webhook Relay',
        status: 'warn',
        message: 'Not configured (optional)',
        fix: 'Create ~/.panopticon/github-app/smee-url with your smee.io channel URL',
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

  for (const { config } of listProjectsSync()) {
    const graphifyCheck = await checkGraphifyFreshness(config.path);
    if (graphifyCheck) {
      checks.push(graphifyCheck);
    }
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
    console.log(chalk.dim('Fix the errors above before using Panopticon.'));
  } else if (hasWarnings) {
    console.log(chalk.yellow('System is functional with some optional features missing.'));
  } else {
    console.log(chalk.green('All systems operational!'));
  }
  console.log('');

  if (hasErrors) {
    process.exit(1);
  }
  if (options.strict && hasWarnings) {
    process.exit(1);
  }
}
