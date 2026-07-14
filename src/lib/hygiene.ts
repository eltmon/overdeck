/** Read-only orchestration hygiene audit, with explicitly requested safe fixes. */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { statSync } from 'fs';
import { join } from 'path';
import type { HygieneReport } from '@overdeck/contracts';
import { listAgentStates } from './agents.js';
import { listSessionsSync } from './tmux.js';
import { getOverdeckHome } from './paths.js';

const execFileAsync = promisify(execFile);
const BACKUP_RE = /(?:\.backup-[^/]*|\.bak|\.orig)$/i;
const TREE_EXCLUSIONS = ['.pan/continues/', 'graphify-out/'];

export interface HygieneOptions {
  root: string;
  skip?: string[];
  since?: string;
  fixSafe?: boolean;
  diskFloorGb?: number;
}

export interface HygieneRunner {
  run(command: string, args: string[], cwd: string): Promise<string>;
  agents(): Array<{ id: string; role?: string; status: string; paused?: boolean; troubled?: boolean }>;
  sessions(): Array<{ name: string }>;
}

interface PullRequestRow {
  number: number;
  headRefName: string;
  state: string;
  mergedAt?: string | null;
  mergeable?: string;
  reviewDecision?: string;
  isDraft?: boolean;
  url: string;
  labels?: Array<{ name: string }>;
  statusCheckRollup?: Array<{ status?: string; conclusion?: string }>;
}

interface WorktreeRow { path: string; branch: string | null }
interface BranchRow { name: string; remote: boolean; committedAt: number }

export const defaultHygieneRunner: HygieneRunner = {
  async run(command, args, cwd) {
    const { stdout } = await execFileAsync(command, args, { cwd, encoding: 'utf-8', timeout: 30_000 });
    return stdout;
  },
  agents: () => listAgentStates(),
  sessions: () => listSessionsSync(),
};

async function safely(runner: HygieneRunner, command: string, args: string[], cwd: string): Promise<string> {
  try { return await runner.run(command, args, cwd); } catch { return ''; }
}

export function parseDurationMs(input = '4w'): number {
  const match = input.match(/^(\d+)([hdw])$/i);
  if (!match) throw new Error(`Invalid duration "${input}"; use hours/days/weeks such as 24h, 7d, or 4w`);
  const unit = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2].toLowerCase() as 'h' | 'd' | 'w'];
  return Number(match[1]) * unit;
}

export function parseGitStatus(raw: string): { files: string[]; backups: string[] } {
  const files = raw.split('\n').filter(Boolean).map((line) => line.slice(3))
    .map((path) => path.includes(' -> ') ? path.split(' -> ').at(-1)! : path)
    .filter((path) => !TREE_EXCLUSIONS.some((prefix) => path.startsWith(prefix)));
  return { files, backups: files.filter((path) => BACKUP_RE.test(path)) };
}

export function classifyPullRequest(pr: PullRequestRow): HygieneReport['prs'][number]['blocking'] {
  const labels = pr.labels?.map((label) => label.name.toLowerCase()) ?? [];
  if (labels.some((label) => label.includes('awaiting-uat') || label.includes('uat-required'))) return 'awaiting-UAT';
  const checks = pr.statusCheckRollup ?? [];
  if (checks.some((check) => check.conclusion && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(check.conclusion))) return 'failing-checks';
  if (checks.some((check) => check.status && check.status !== 'COMPLETED')) return 'test-pending';
  if (pr.isDraft || !['APPROVED', ''].includes(pr.reviewDecision ?? '')) return 'review-pending';
  return 'clean';
}

export function parseWorktrees(raw: string): WorktreeRow[] {
  return raw.trim().split('\n\n').filter(Boolean).map((block) => {
    const lines = block.split('\n');
    const path = lines.find((line) => line.startsWith('worktree '))?.slice(9) ?? '';
    const branchRef = lines.find((line) => line.startsWith('branch '))?.slice(7);
    return { path, branch: branchRef?.replace(/^refs\/heads\//, '') ?? null };
  }).filter((row) => row.path.length > 0);
}

export function parseBranches(raw: string): BranchRow[] {
  return raw.split('\n').filter(Boolean).map((line) => {
    const [ref, date = ''] = line.split('|');
    const remote = ref.startsWith('origin/');
    return { name: ref.replace(/^origin\//, ''), remote, committedAt: Date.parse(date) || 0 };
  }).filter((row) => row.name.startsWith('feature/'));
}

function parseDiskAvailableGb(raw: string): number {
  const lines = raw.trim().split('\n');
  const fields = lines.at(-1)?.trim().split(/\s+/) ?? [];
  const availableKb = Number(fields[3] ?? 0);
  return Math.round((availableKb / 1_048_576) * 10) / 10;
}

function issueNumberFromBranch(branch: string): number | null {
  const match = branch.match(/^[^/]+\/[a-z]+-(\d+)/i);
  return match ? Number(match[1]) : null;
}

export async function collectHygieneReport(
  options: HygieneOptions,
  runner: HygieneRunner = defaultHygieneRunner,
): Promise<HygieneReport> {
  const root = options.root;
  const skipped = new Set(options.skip ?? []);
  const thresholdGb = options.diskFloorGb ?? 10;
  const cutoff = Date.now() - parseDurationMs(options.since);
  const empty = (name: string) => skipped.has(name);

  const pushRaw = empty('push') ? '' : await safely(runner, 'git', ['log', '--format=%h %s', 'origin/main..HEAD'], root);
  const commits = pushRaw.split('\n').filter(Boolean);
  const tree = empty('tree') ? { files: [], backups: [] } : parseGitStatus(
    await safely(runner, 'git', ['status', '--porcelain=v1', '--untracked-files=all'], root),
  );

  const prRaw = empty('prs') ? '[]' : await safely(runner, 'gh', [
    'pr', 'list', '--state', 'all', '--limit', '200', '--json',
    'number,headRefName,state,mergedAt,mergeable,reviewDecision,isDraft,url,labels,statusCheckRollup',
  ], root);
  let allPrs: PullRequestRow[] = [];
  try { allPrs = JSON.parse(prRaw || '[]') as PullRequestRow[]; } catch { /* surfaced as empty */ }
  const openPrs = allPrs.filter((pr) => pr.state === 'OPEN');
  const prs = openPrs.map((pr) => ({
    number: pr.number,
    branch: pr.headRefName,
    url: pr.url,
    blocking: classifyPullRequest(pr),
  }));

  const agentStates = empty('agents') ? [] : runner.agents();
  const counts: Record<string, number> = {};
  const problems: Array<{ id: string; summary: string; detail?: string; urgent?: boolean }> = [];
  for (const agent of agentStates) {
    const role = agent.role ?? 'unknown';
    if (agent.status !== 'stopped' || agent.paused || agent.troubled) {
      counts[role] = (counts[role] ?? 0) + 1;
    }
    if (agent.troubled || agent.paused || agent.status === 'error') {
      problems.push({ id: agent.id, summary: `${role} agent is ${agent.troubled ? 'troubled' : agent.paused ? 'paused' : agent.status}` });
    }
  }

  const sessions = empty('sessions') ? [] : runner.sessions();
  const stopped = new Set(agentStates.filter((agent) => agent.status === 'stopped').map((agent) => agent.id));
  const zombies = sessions.map((session) => session.name).filter((name) => stopped.has(name));

  const branchRaw = empty('branches') ? '' : await safely(runner, 'git', [
    'for-each-ref', '--format=%(refname:short)|%(committerdate:iso-strict)',
    'refs/heads/feature', 'refs/remotes/origin/feature',
  ], root);
  const branchRows = parseBranches(branchRaw);
  const mergedBranches = new Set(allPrs.filter((pr) => pr.mergedAt).map((pr) => pr.headRefName));
  const staleBranchRows = branchRows.filter((branch) => mergedBranches.has(branch.name) && branch.committedAt <= cutoff);
  const staleBranches = [...new Set(staleBranchRows.map((branch) => `${branch.remote ? 'origin/' : ''}${branch.name}`))];

  const worktreeRows = empty('workspaces') ? [] : parseWorktrees(
    await safely(runner, 'git', ['worktree', 'list', '--porcelain'], root),
  );
  const branchNames = new Set(branchRows.map((branch) => branch.name));
  const closedRaw = empty('workspaces') ? '[]' : await safely(runner, 'gh', ['issue', 'list', '--state', 'closed', '--limit', '500', '--json', 'number'], root);
  let closedNumbers = new Set<number>();
  try { closedNumbers = new Set((JSON.parse(closedRaw || '[]') as Array<{ number: number }>).map((issue) => issue.number)); } catch { /* empty */ }
  const staleWorktreeRows = worktreeRows.filter((worktree) => {
    if (!worktree.branch?.startsWith('feature/')) return false;
    const issueNumber = issueNumberFromBranch(worktree.branch);
    const terminal = mergedBranches.has(worktree.branch) || (issueNumber !== null && closedNumbers.has(issueNumber));
    const oldEnough = (() => { try { return statSync(worktree.path).mtimeMs <= cutoff; } catch { return false; } })();
    return terminal && (!branchNames.has(worktree.branch) || oldEnough);
  });

  const diskPaths = [root, getOverdeckHome()];
  const diskValues = await Promise.all(diskPaths.map(async (path) => parseDiskAvailableGb(
    await safely(runner, 'df', ['-Pk', path], root),
  )));
  let availableGb = Math.min(...diskValues.filter((value) => value > 0));
  if (!Number.isFinite(availableGb)) availableGb = 0;
  const fixes: {
    branchesDeleted: string[];
    workspacesRemoved: Array<{ path: string; freedBytes: number }>;
    errors: string[];
  } = { branchesDeleted: [], workspacesRemoved: [], errors: [] };

  if (options.fixSafe) {
    for (const branch of [...new Set(staleBranchRows.map((row) => row.name))]) {
      const local = branchRows.some((row) => row.name === branch && !row.remote);
      const remote = branchRows.some((row) => row.name === branch && row.remote);
      try {
        if (local) await runner.run('git', ['branch', '-d', branch], root);
        if (remote) await runner.run('git', ['push', 'origin', '--delete', branch], root);
        fixes.branchesDeleted.push(branch);
      } catch (error) {
        fixes.errors.push(`${branch}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const worktree of staleWorktreeRows.sort((a, b) => statSync(a.path).mtimeMs - statSync(b.path).mtimeMs)) {
      if (availableGb >= thresholdGb) break;
      const branch = worktree.branch!;
      if (branchNames.has(branch) || openPrs.some((pr) => pr.headRefName === branch) || sessions.some((session) => session.name.includes(branch.replace('feature/', '')))) continue;
      const dirty = await safely(runner, 'git', ['status', '--porcelain'], worktree.path);
      if (dirty.trim()) continue;
      try {
        const du = await safely(runner, 'du', ['-sk', worktree.path], root);
        const freedBytes = Number(du.trim().split(/\s+/)[0] ?? 0) * 1024;
        await runner.run('git', ['worktree', 'remove', worktree.path], root);
        fixes.workspacesRemoved.push({ path: worktree.path, freedBytes });
        availableGb = parseDiskAvailableGb(await safely(runner, 'df', ['-Pk', root], root));
      } catch (error) {
        fixes.errors.push(`${worktree.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const needsAttention = commits.length > 0 || tree.files.length > 0 || prs.some((pr) => pr.blocking !== 'clean')
    || problems.length > 0 || zombies.length > 0 || staleBranches.length > 0 || staleWorktreeRows.length > 0
    || availableGb < thresholdGb || fixes.errors.length > 0;
  const report: HygieneReport = {
    generatedAt: new Date().toISOString(), root, skipped: [...skipped],
    push: { ahead: commits.length, commits }, tree, prs,
    agents: { counts, problems }, sessions: { total: sessions.length, zombies },
    branches: { stale: staleBranches }, workspaces: { stale: staleWorktreeRows.map((row) => row.path) },
    disk: { availableGb, thresholdGb, urgent: availableGb < thresholdGb }, fixes,
    needsAttention,
  };
  return report;
}
