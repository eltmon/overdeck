import { execFile } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { createInterface } from 'readline/promises';
import { promisify } from 'util';
import { join } from 'path';
import chalk from 'chalk';
import { getPanopticonHome } from '../../lib/paths.js';

const execFileAsync = promisify(execFile);
const WORKSPACE_PROJECT_PREFIX = 'panopticon-feature-';
const ACTIVE_AGENT_STATUSES = new Set(['running', 'starting']);

export interface WorkspaceReapOptions {
  days?: string;
  apply?: boolean;
  yes?: boolean;
}

interface DockerInspectContainer {
  Id?: string;
  Name?: string;
  Created?: string;
  Config?: {
    Labels?: Record<string, string>;
  };
  State?: {
    Status?: string;
    ExitCode?: number;
  };
}

export interface ReapCandidate {
  project: string;
  issueId: string;
  reason: string;
  ageDays: number;
  containers: Array<{
    id: string;
    name: string;
    status: string;
    exitCode: number;
    createdAt: string;
  }>;
  composeFiles: string[];
  workingDir?: string;
}

interface CandidateGroup {
  project: string;
  issueId: string;
  containers: ReapCandidate['containers'];
  composeFiles: Set<string>;
  workingDir?: string;
  reasons: string[];
  oldestBadCreatedMs: number;
}

export function parseReapDays(value: string | undefined): number {
  const raw = value ?? '7';
  const days = Number.parseInt(raw, 10);
  if (!Number.isInteger(days) || days < 0 || String(days) !== raw.trim()) {
    throw new Error(`--days must be a non-negative integer, got ${JSON.stringify(raw)}`);
  }
  return days;
}

function normalizeIssueId(value: string): string {
  return value.toLowerCase().replace(/^feature-/, '').replace(/[^a-z0-9-]/g, '-');
}

function issueIdFromProject(project: string): string {
  const lower = project.toLowerCase();
  if (lower.startsWith(WORKSPACE_PROJECT_PREFIX)) {
    return normalizeIssueId(lower.slice(WORKSPACE_PROJECT_PREFIX.length));
  }
  return normalizeIssueId(lower);
}

function parseComposeFiles(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(file => file.trim())
    .filter(Boolean);
}

function isBadContainer(status: string, exitCode: number): string | null {
  if (status === 'created') return 'Created';
  if (status === 'exited' && exitCode !== 0) return `Exited (${exitCode})`;
  return null;
}

export function collectWorkspaceReapCandidatesFromInspect(
  containers: DockerInspectContainer[],
  cutoffMs: number,
  nowMs: number = Date.now(),
): ReapCandidate[] {
  const groups = new Map<string, CandidateGroup>();

  for (const container of containers) {
    const labels = container.Config?.Labels ?? {};
    const name = (container.Name ?? '').replace(/^\//, '');
    const project = labels['com.docker.compose.project'] ?? name.split('-').slice(0, -2).join('-');
    if (!name.includes(WORKSPACE_PROJECT_PREFIX) && !project.startsWith(WORKSPACE_PROJECT_PREFIX)) {
      continue;
    }

    const status = (container.State?.Status ?? '').toLowerCase();
    const exitCode = container.State?.ExitCode ?? 0;
    const reason = isBadContainer(status, exitCode);
    if (!reason) continue;

    const createdMs = Date.parse(container.Created ?? '');
    if (!Number.isFinite(createdMs) || createdMs > cutoffMs) continue;

    const id = container.Id ?? '';
    if (!id) continue;

    let group = groups.get(project);
    if (!group) {
      group = {
        project,
        issueId: issueIdFromProject(project),
        containers: [],
        composeFiles: new Set(),
        workingDir: labels['com.docker.compose.project.working_dir'],
        reasons: [],
        oldestBadCreatedMs: createdMs,
      };
      groups.set(project, group);
    }

    for (const file of parseComposeFiles(labels['com.docker.compose.project.config_files'])) {
      if (existsSync(file)) group.composeFiles.add(file);
    }
    if (!group.workingDir && labels['com.docker.compose.project.working_dir']) {
      group.workingDir = labels['com.docker.compose.project.working_dir'];
    }
    group.oldestBadCreatedMs = Math.min(group.oldestBadCreatedMs, createdMs);
    group.containers.push({
      id,
      name,
      status,
      exitCode,
      createdAt: container.Created ?? '',
    });
    group.reasons.push(`${name}: ${reason}`);
  }

  return [...groups.values()]
    .map(group => ({
      project: group.project,
      issueId: group.issueId,
      reason: group.reasons.join(', '),
      ageDays: Math.floor((nowMs - group.oldestBadCreatedMs) / 86_400_000),
      containers: group.containers,
      composeFiles: [...group.composeFiles],
      workingDir: group.workingDir,
    }))
    .sort((a, b) => b.ageDays - a.ageDays || a.project.localeCompare(b.project));
}

function collectActiveAgentIssueIds(): Set<string> {
  const activeIssues = new Set<string>();
  const agentsDir = join(getPanopticonHome(), 'agents');
  if (!existsSync(agentsDir)) return activeIssues;

  for (const dir of readdirSync(agentsDir)) {
    const stateFile = join(agentsDir, dir, 'state.json');
    if (!existsSync(stateFile)) continue;
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as {
        issueId?: string;
        status?: string;
      };
      if (!state.issueId || !state.status || !ACTIVE_AGENT_STATUSES.has(state.status)) continue;
      activeIssues.add(normalizeIssueId(state.issueId));
    } catch {}
  }

  return activeIssues;
}

async function listMatchingContainerIds(): Promise<string[]> {
  const { stdout } = await execFileAsync('docker', [
    'ps',
    '-a',
    '--filter',
    `name=${WORKSPACE_PROJECT_PREFIX}`,
    '--format',
    '{{.ID}}',
  ], { encoding: 'utf-8' });
  return stdout.trim().split('\n').map(line => line.trim()).filter(Boolean);
}

async function inspectContainers(ids: string[]): Promise<DockerInspectContainer[]> {
  if (ids.length === 0) return [];
  const { stdout } = await execFileAsync('docker', [
    'inspect',
    ...ids,
    '--format',
    '{{json .}}',
  ], { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 });
  return stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function confirmApply(candidates: ReapCandidate[], yes: boolean | undefined): Promise<boolean> {
  if (yes) {
    console.log(chalk.dim('  --yes given; skipping interactive confirmation.'));
    return true;
  }

  if (!process.stdin.isTTY) {
    console.error(chalk.red('✗ --apply requires an interactive terminal, or pass --yes for non-interactive use.'));
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const expected = String(candidates.length);
    const answer = (
      await rl.question(chalk.bold(`Type "${expected}" to reap these workspace stack(s), anything else to cancel: `))
    ).trim();
    return answer === expected;
  } finally {
    rl.close();
  }
}

async function composeDown(candidate: ReapCandidate): Promise<void> {
  const args = [
    'compose',
    ...candidate.composeFiles.flatMap(file => ['-f', file]),
    '-p',
    candidate.project,
    'down',
    '-v',
    '--remove-orphans',
  ];
  await execFileAsync('docker', args, {
    cwd: candidate.workingDir && existsSync(candidate.workingDir) ? candidate.workingDir : process.cwd(),
    encoding: 'utf-8',
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function printCandidates(candidates: ReapCandidate[], apply: boolean | undefined): void {
  if (candidates.length === 0) {
    console.log(chalk.green('No orphaned workspace Docker stacks found.'));
    return;
  }

  console.log(chalk.bold(`${apply ? 'Will reap' : 'Would reap'} ${candidates.length} workspace Docker stack(s):`));
  console.log('');
  for (const candidate of candidates) {
    console.log(`${chalk.cyan(candidate.project)} (${candidate.issueId.toUpperCase()}, ${candidate.ageDays}d old)`);
    console.log(`  ${candidate.reason}`);
    if (candidate.composeFiles.length > 0) {
      console.log(chalk.dim(`  compose: ${candidate.composeFiles.join(', ')}`));
    } else {
      console.log(chalk.yellow('  compose: no existing config file label found; using project-name cleanup'));
    }
  }
  console.log('');
  if (!apply) {
    console.log(chalk.dim('Dry run only. Re-run with --apply to run docker compose down -v --remove-orphans.'));
  }
}

export async function workspaceReapCommand(options: WorkspaceReapOptions = {}): Promise<void> {
  let days: number;
  try {
    days = parseReapDays(options.days);
  } catch (error: any) {
    console.error(chalk.red(`✗ ${error.message}`));
    process.exit(1);
  }

  const cutoffMs = Date.now() - days * 86_400_000;
  let containers: DockerInspectContainer[];
  try {
    const ids = await listMatchingContainerIds();
    containers = await inspectContainers(ids);
  } catch (error: any) {
    console.error(chalk.red(`✗ Failed to query Docker containers: ${error.message ?? error}`));
    process.exit(1);
  }

  const activeAgentIssueIds = collectActiveAgentIssueIds();
  const candidates = collectWorkspaceReapCandidatesFromInspect(containers, cutoffMs)
    .filter(candidate => {
      if (!activeAgentIssueIds.has(candidate.issueId)) return true;
      console.log(chalk.yellow(`Skipping ${candidate.project}: active agent state exists for ${candidate.issueId.toUpperCase()}`));
      return false;
    });

  printCandidates(candidates, options.apply);
  if (!options.apply || candidates.length === 0) return;

  const confirmed = await confirmApply(candidates, options.yes);
  if (!confirmed) {
    console.log(chalk.green('Cancelled — no Docker stacks were reaped.'));
    return;
  }

  for (const candidate of candidates) {
    try {
      await composeDown(candidate);
      console.log(chalk.green(`✓ Reaped ${candidate.project}`));
    } catch (error: any) {
      console.error(chalk.red(`✗ Failed to reap ${candidate.project}: ${error.message ?? error}`));
      process.exitCode = 1;
    }
  }
}
