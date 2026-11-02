/**
 * PAN-4820 WI-5: what the Deft merge guard refuses, rule by rule, and that
 * the per-issue guard fails closed when it cannot read the PR's diff.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { workspace } = vi.hoisted(() => ({ workspace: { path: '' } }));

vi.mock('../../overdeck/issue-projects.js', () => ({
  getIssueWorkspacePath: vi.fn(() => workspace.path),
  resolveProjectForIssue: vi.fn(() => null),
}));

import { installDeftIntoWorktree } from '../install.js';
import type { DeftInstallSnapshot } from '../install-snapshot.js';
import { type DeftGuardInput, deftMergeGuardForIssue, evaluateDeftMergeGuard } from '../merge-guard.js';

const scratch = mkdtempSync(join(tmpdir(), 'deft-guard-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function input(overrides: Partial<DeftGuardInput> = {}, files: Record<string, string> = {}): DeftGuardInput {
  return {
    changedPaths: [],
    headFile: async path => files[path] ?? null,
    snapshot: null,
    directiveProject: false,
    drifted: [],
    archiveCurrent: true,
    ...overrides,
  };
}

const snapshot: DeftInstallSnapshot = {
  version: 1,
  issueId: 'PAN-1',
  installedAt: '2026-11-02T00:00:00Z',
  runtimeVersion: '0.127.0',
  createdPaths: ['Taskfile.yml', 'custom-deposit/'],
  modifiedTracked: [{ path: 'tsconfig.json', restoreContentB64: '', postInstallSha256: '', baseBlob: '' }],
  modifiedUntracked: [],
  touchedPreexisting: [],
  sharedHooksPathBefore: null,
  excludeFile: '/x',
};

describe('evaluateDeftMergeGuard', () => {
  it('refuses a diff containing .githooks/pre-push and names it', async () => {
    const verdict = await evaluateDeftMergeGuard(input({ changedPaths: ['src/a.ts', '.githooks/pre-push'] }));

    expect(verdict).toEqual({ ok: false, reason: 'PR contains Deft install paths: .githooks/pre-push', paths: ['.githooks/pre-push'] });
  });

  it('allows the Deft state archive under .pan/deft/<ISSUE>/', async () => {
    const verdict = await evaluateDeftMergeGuard(
      input({ changedPaths: ['.pan/deft/PAN-1/scopes/active/x.xbrief.json', '.pan/deft/PAN-1/escalations/e.json'], snapshot }),
    );

    expect(verdict).toEqual({ ok: true });
  });

  it('refuses every root deposit prefix and pointer, wrapper and hook pattern', async () => {
    const deposit = [
      '.deft/GENERATION.json',
      '.deft-scratch/x',
      '.deft-cache/finish-loop-progress.jsonl',
      'xbrief/active/a.xbrief.json',
      '.claude/skills/deft/SKILL.md',
      '.agents/skills/deft-directive-build/SKILL.md',
      '.github/skills/deft-directive-sync/SKILL.md',
      '.claude/commands/deft-continue.md',
      '.grok/commands/deft-checkpoint.md',
      '.codex/prompts/deft-continue.md',
      '.claude/deft-hook-1a2b3c4d.mjs',
      '.cursor/hooks/deft-hook-1a2b3c4d.mjs',
      '.grok/hooks/deft.json',
    ];
    const verdict = await evaluateDeftMergeGuard(input({ changedPaths: [...deposit, '.claude/skills/grilling/SKILL.md', 'docs/xbrief/a.md'] }));

    expect(verdict).toMatchObject({ ok: false, paths: deposit });
  });

  it('refuses paths equal to or under snapshot paths', async () => {
    const verdict = await evaluateDeftMergeGuard(
      input({ changedPaths: ['Taskfile.yml', 'custom-deposit/a.txt', 'tsconfig.json', 'custom-deposit-other.txt'], snapshot }),
    );

    expect(verdict).toMatchObject({ ok: false, paths: ['Taskfile.yml', 'custom-deposit/a.txt', 'tsconfig.json'] });
  });

  it('refuses AGENTS.md when its head content carries the managed section', async () => {
    const changedPaths = ['AGENTS.md'];

    expect(await evaluateDeftMergeGuard(input({ changedPaths }, { 'AGENTS.md': '# Agents\n<!-- deft:managed-section v3 -->\n' })))
      .toMatchObject({ ok: false, paths: ['AGENTS.md'] });
    expect(await evaluateDeftMergeGuard(input({ changedPaths }, { 'AGENTS.md': '# Agents\n' }))).toEqual({ ok: true });
  });

  it('refuses package.json, Taskfile.yml and .gitignore only when their head content carries Directive markers', async () => {
    const changedPaths = ['package.json', 'Taskfile.yml', '.gitignore'];
    const marked = {
      'package.json': '{"devDependencies":{"@deftai/directive-runtime":"0.127.0"}}',
      'Taskfile.yml': 'includes:\n  deft: ./node_modules/@deftai/directive-runtime/Taskfile.yml\n',
      '.gitignore': '.deft/directive/wiring-ready.*.json\n',
    };

    expect(await evaluateDeftMergeGuard(input({ changedPaths }, marked))).toMatchObject({ ok: false, paths: changedPaths });
    expect(await evaluateDeftMergeGuard(input({ changedPaths }, { 'package.json': '{}', 'Taskfile.yml': '', '.gitignore': 'dist/\n' })))
      .toEqual({ ok: true });
  });

  it('refuses drift before anything else', async () => {
    const verdict = await evaluateDeftMergeGuard(input({ drifted: ['package.json'], changedPaths: ['.githooks/pre-push'], archiveCurrent: false }));

    expect(verdict).toEqual({
      ok: false,
      reason: 'Deft-hidden files were edited and are in no commit: package.json. Switch back to Overdeck or ask the operator.',
      paths: ['package.json'],
    });
  });

  it('refuses a stale archive', async () => {
    expect(await evaluateDeftMergeGuard(input({ archiveCurrent: false }))).toEqual({
      ok: false,
      reason: 'Deft state is not saved at the PR head; run pan skills deft save <ISSUE>',
      paths: [],
    });
  });

  it('skips every rule for a native Directive project', async () => {
    const verdict = await evaluateDeftMergeGuard(
      input({ directiveProject: true, changedPaths: ['xbrief/active/a.xbrief.json'], drifted: ['x'], archiveCurrent: false }),
    );

    expect(verdict).toEqual({ ok: true });
  });
});

describe('deftMergeGuardForIssue', () => {
  it('fails closed when git diff fails', async () => {
    workspace.path = mkdtempSync(join(scratch, 'not-a-repo-'));

    const verdict = await deftMergeGuardForIssue('PAN-1', 'a'.repeat(40));

    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toMatch(/^merge guard could not read the PR's changed files: /);
    expect(verdict.drifted).toEqual([]);
  });
});

describe('deftMergeGuardForIssue with a temporary install', () => {
  const savedEnv = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
  let wt: string;
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });
  const write = (base: string, path: string, content: string): void => {
    mkdirSync(join(base, path, '..'), { recursive: true });
    writeFileSync(join(base, path), content);
  };

  beforeAll(() => {
    const globalConfig = join(scratch, 'gitconfig');
    writeFileSync(globalConfig, '[user]\n\tname = Overdeck Test\n\temail = test@overdeck.local\n[commit]\n\tgpgsign = false\n');
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function installed(): Promise<void> {
    const root = mkdtempSync(join(scratch, 'repo-'));
    const main = join(root, 'main');
    wt = join(root, 'wt');
    mkdirSync(main);
    git(main, 'init', '-q', '-b', 'main');
    write(main, 'package.json', '{"name":"probe"}\n');
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'seed');
    git(main, 'update-ref', 'refs/remotes/origin/main', 'main');
    git(main, 'worktree', 'add', '-q', '-b', 'feature/pan-1', wt);
    const result = await installDeftIntoWorktree(wt, 'PAN-1', {
      runInstall: async (worktree) => {
        write(worktree, 'AGENTS.md', '<!-- deft:managed-section v3 -->\n');
        write(worktree, '.githooks/pre-push', '#!/bin/sh\nexit 0\n');
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    expect(result).toMatchObject({ ok: true, mode: 'installed' });
    workspace.path = wt;
  }

  it('passes a clean PR while the snapshot is in place', async () => {
    await installed();

    expect(await deftMergeGuardForIssue('PAN-1', git(wt, 'rev-parse', 'HEAD').trim())).toMatchObject({ ok: true });
  });

  it('refuses when the snapshot was deleted and the deposit was force-added', async () => {
    await installed();
    rmSync(join(wt, '.overdeck'), { recursive: true, force: true });
    git(wt, 'add', '-f', '.githooks/pre-push');
    git(wt, 'commit', '-q', '-m', 'sneak the hook in');

    const verdict = await deftMergeGuardForIssue('PAN-1', git(wt, 'rev-parse', 'HEAD').trim());

    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toContain('Deft install snapshot for PAN-1 (.overdeck/deft-install.json) is missing or unreadable');
  });

  it('refuses when the snapshot is corrupt', async () => {
    await installed();
    writeFileSync(join(wt, '.overdeck', 'deft-install.json'), '{ not json');

    const verdict = await deftMergeGuardForIssue('PAN-1', git(wt, 'rev-parse', 'HEAD').trim());

    expect(!verdict.ok && verdict.reason).toContain('is missing or unreadable');
  });
});
