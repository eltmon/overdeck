/**
 * PAN-4820 WI-5: what the Deft merge guard refuses, rule by rule, and that
 * the per-issue guard fails closed when it cannot read the PR's diff.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const { workspace } = vi.hoisted(() => ({ workspace: { path: '' } }));

vi.mock('../../overdeck/issue-projects.js', () => ({
  getIssueWorkspacePath: vi.fn(() => workspace.path),
  resolveProjectForIssue: vi.fn(() => null),
}));

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
