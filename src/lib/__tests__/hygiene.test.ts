import { afterEach, describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import { HygieneReport } from '@overdeck/contracts';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, mkdirSync, rmSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  classifyPullRequest,
  collectHygieneReport,
  defaultHygieneRunner,
  parseBranches,
  parseDurationMs,
  parseGitStatus,
  parseWorktrees,
  type HygieneRunner,
} from '../hygiene.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('hygiene finding logic', () => {
  it('parses duration thresholds', () => {
    expect(parseDurationMs('4w')).toBe(28 * 86_400_000);
    expect(() => parseDurationMs('tomorrow')).toThrow('Invalid duration');
  });

  it('filters generated state while retaining source changes and backups', () => {
    expect(parseGitStatus(' M src/a.ts\n?? .beads/issues.jsonl\n?? notes.orig\n')).toEqual({
      files: ['src/a.ts', 'notes.orig'], backups: ['notes.orig'],
    });
  });

  it('classifies PR verification and review blockers', () => {
    expect(classifyPullRequest({ number: 1, headRefName: 'feature/a', state: 'OPEN', url: '', statusCheckRollup: [{ conclusion: 'FAILURE' }] })).toBe('failing-checks');
    expect(classifyPullRequest({ number: 1, headRefName: 'feature/a', state: 'OPEN', url: '', statusCheckRollup: [{ status: 'IN_PROGRESS' }] })).toBe('test-pending');
    expect(classifyPullRequest({ number: 1, headRefName: 'feature/a', state: 'OPEN', url: '', reviewDecision: 'REVIEW_REQUIRED' })).toBe('review-pending');
  });

  it('parses local/remote feature refs and worktrees', () => {
    expect(parseBranches('feature/pan-1|2026-01-01T00:00:00Z\norigin/feature/pan-1|2026-01-01T00:00:00Z\n')).toHaveLength(2);
    expect(parseWorktrees('worktree /repo\nbranch refs/heads/main\n\nworktree /repo/workspaces/feature-pan-1\nbranch refs/heads/feature/pan-1\n')).toEqual([
      { path: '/repo', branch: 'main' },
      { path: '/repo/workspaces/feature-pan-1', branch: 'feature/pan-1' },
    ]);
  });

  it('collects typed push, tree, PR, agent, session, branch, workspace, and disk findings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hygiene-report-')); roots.push(root);
    const workspace = join(root, 'workspaces', 'feature-pan-1504');
    mkdirSync(workspace, { recursive: true });
    utimesSync(workspace, new Date('2025-01-01'), new Date('2025-01-01'));
    const merged = JSON.stringify([{ number: 10, headRefName: 'feature/pan-1504', state: 'MERGED', mergedAt: '2026-01-01', url: 'https://example/10' }]);
    const runner: HygieneRunner = {
      async run(command, args) {
        const key = `${command} ${args.slice(0, 3).join(' ')}`;
        if (key.startsWith('git log')) return 'abc123 local commit\n';
        if (key.startsWith('git status')) return ' M src/a.ts\n';
        if (key.startsWith('gh pr list')) return merged;
        if (key.startsWith('gh issue list')) return '[{"number":1504}]';
        if (key.startsWith('git for-each-ref')) return 'feature/pan-1504|2025-01-01T00:00:00Z\n';
        if (key.startsWith('git worktree list')) return `worktree ${root}\nbranch refs/heads/main\n\nworktree ${workspace}\nbranch refs/heads/feature/pan-1504\n`;
        if (command === 'df') return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/x 10000000 1 5242880 1% /\n';
        return '';
      },
      agents: () => [{ id: 'agent-pan-1', role: 'work', status: 'stopped', troubled: true }],
      sessions: () => [{ name: 'agent-pan-1' }],
    };
    const report = await collectHygieneReport({ root }, runner);
    expect(report.push.ahead).toBe(1);
    expect(report.tree.files).toEqual(['src/a.ts']);
    expect(report.agents.problems).toHaveLength(1);
    expect(report.sessions.zombies).toEqual(['agent-pan-1']);
    expect(report.branches.stale).toEqual(['feature/pan-1504']);
    expect(report.workspaces.stale).toEqual([workspace]);
    expect(report.disk.urgent).toBe(true);
    expect(() => Schema.decodeUnknownSync(HygieneReport)(report)).not.toThrow();
  });

  it('fix-safe deletes a locally merged feature branch in a synthetic repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hygiene-fix-')); roots.push(root);
    const run = async (...args: string[]) => { await execFileAsync('git', args, { cwd: root }); };
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.email', 'test@example.com');
    await run('config', 'user.name', 'Test');
    await run('commit', '--allow-empty', '-q', '-m', 'init');
    await run('checkout', '-q', '-b', 'feature/pan-1504');
    await run('commit', '--allow-empty', '-q', '-m', 'feature');
    await run('checkout', '-q', 'main');
    await run('merge', '-q', '--no-edit', 'feature/pan-1504');
    const runner: HygieneRunner = {
      ...defaultHygieneRunner,
      async run(command, args, cwd) {
        if (command === 'gh' && args[0] === 'pr') return JSON.stringify([{ number: 10, headRefName: 'feature/pan-1504', state: 'MERGED', mergedAt: '2026-01-01', url: 'https://example/10' }]);
        if (command === 'gh') return '[]';
        return defaultHygieneRunner.run(command, args, cwd);
      },
      agents: () => [], sessions: () => [],
    };
    const report = await collectHygieneReport({ root, fixSafe: true, since: '0h' }, runner);
    expect(report.fixes.branchesDeleted).toEqual(['feature/pan-1504']);
    const { stdout } = await execFileAsync('git', ['branch', '--list', 'feature/pan-1504'], { cwd: root });
    expect(stdout.trim()).toBe('');
  });
});
