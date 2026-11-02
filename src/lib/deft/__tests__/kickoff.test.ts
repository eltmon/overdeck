/**
 * PAN-4820 WI-11: a Deft issue's work agent gets Deft's kickoff, an Overdeck
 * issue keeps the work template, and a worktree with no Directive install
 * refuses rather than installing.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { isDeftPipelineIssue } = vi.hoisted(() => ({ isDeftPipelineIssue: vi.fn() }));
vi.mock('../issue-pipeline.js', () => ({ isDeftPipelineIssue }));

import { buildWorkAgentPrompt } from '../../cloister/work-agent-prompt.js';
import { writeDeftSnapshot } from '../install-snapshot.js';
import { DeftNotInstalledError } from '../kickoff.js';

const scratch = mkdtempSync(join(tmpdir(), 'deft-kickoff-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const build = (workspacePath: string) =>
  buildWorkAgentPrompt({ issueId: 'TST-1', env: 'LOCAL', workspacePath, skipDynamicContext: true });

beforeEach(() => {
  isDeftPipelineIssue.mockReset();
});

describe('buildWorkAgentPrompt for a Deft issue', () => {
  it('renders Deft\'s kickoff with the hidden tracked files', async () => {
    isDeftPipelineIssue.mockResolvedValue(true);
    const worktree = mkdtempSync(join(scratch, 'wt-'));
    await writeDeftSnapshot(worktree, {
      version: 1,
      issueId: 'TST-1',
      installedAt: '2026-11-02T00:00:00Z',
      runtimeVersion: '0.127.0',
      createdPaths: ['AGENTS.md'],
      modifiedTracked: [
        { path: 'package.json', restoreContentB64: '', postInstallSha256: '', baseBlob: '' },
        { path: 'bun.lock', restoreContentB64: '', postInstallSha256: '', baseBlob: '' },
      ],
      modifiedUntracked: [],
      touchedPreexisting: [],
      sharedHooksPathBefore: null,
      excludeFile: '/x',
    });

    const text = await build(worktree);

    expect(text).toContain('deft-directive-build');
    expect(text).toContain('pan skills deft save TST-1');
    expect(text).toContain('pan sync-main TST-1');
    expect(text).toContain('`gh pr create` from `feature/tst-1`');
    expect(text).toContain('your edits to them will not be committed: package.json, bun.lock.');
    expect(text).toContain('Never merge: a person merges through Overdeck.');
    expect(text).not.toContain('pan task');
  });

  it('refuses a worktree with no Directive install', async () => {
    isDeftPipelineIssue.mockResolvedValue(true);

    await expect(build(mkdtempSync(join(scratch, 'plain-')))).rejects.toBeInstanceOf(DeftNotInstalledError);
    await expect(build(mkdtempSync(join(scratch, 'plain-')))).rejects.toThrow('run pan skills deft use TST-1');
  });
});

describe('buildWorkAgentPrompt for an Overdeck issue', () => {
  it('still renders the work template', async () => {
    isDeftPipelineIssue.mockResolvedValue(false);

    const text = await build(mkdtempSync(join(scratch, 'plain-')));

    expect(text).toContain('MANDATORY: One Item At A Time');
    expect(text).toContain('pan task');
    expect(text).not.toContain('deft-directive-build');
  });
});
