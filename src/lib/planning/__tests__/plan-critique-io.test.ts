import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { planDigest } from '../../xbrief/plan-digest.js';
import {
  countCritiqueRounds,
  critiquePathForRound,
  isPlanFlagged,
  loadCritiqueGateInput,
  resolveWorkspacePrdPath,
} from '../plan-critique-io.js';

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Overdeck Test',
  GIT_AUTHOR_EMAIL: 'test@overdeck.local',
  GIT_COMMITTER_NAME: 'Overdeck Test',
  GIT_COMMITTER_EMAIL: 'test@overdeck.local',
};

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: gitEnv, stdio: 'ignore' });
}

const DOC = { xBRIEFInfo: { version: '0.8' }, plan: { id: 'PAN-9001', title: 'Plan', status: 'draft', items: [] } };

describe('plan critique I/O', () => {
  let workspace: string;
  let prdPath: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'plan-critique-io-'));
    git(workspace, 'init', '-b', 'main');
    mkdirSync(join(workspace, '.pan', 'drafts'), { recursive: true });
    prdPath = join(workspace, '.pan', 'drafts', 'PAN-9001.md');
    writeFileSync(prdPath, '# PRD\n');
    git(workspace, 'add', '.');
    git(workspace, 'commit', '-m', 'prd');
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('resolves the upper-case PRD first, then the lower-case one', () => {
    expect(resolveWorkspacePrdPath(workspace, 'pan-9001')).toBe(prdPath);
    unlinkSync(prdPath);
    const lower = join(workspace, '.pan', 'drafts', 'pan-9001.md');
    writeFileSync(lower, '# PRD\n');
    expect(resolveWorkspacePrdPath(workspace, 'PAN-9001')).toBe(lower);
    unlinkSync(lower);
    expect(resolveWorkspacePrdPath(workspace, 'PAN-9001')).toBeNull();
  });

  it('names critique files from the PRD stem', () => {
    expect(critiquePathForRound(prdPath, 1)).toBe(join(workspace, '.pan', 'drafts', 'PAN-9001-critique.md'));
    expect(critiquePathForRound(prdPath, 2)).toBe(join(workspace, '.pan', 'drafts', 'PAN-9001-critique-2.md'));
  });

  it('counts no rounds when no critique exists', async () => {
    expect(await countCritiqueRounds(workspace, prdPath)).toBe(0);
  });

  it('counts a round whose file is only in the tree', async () => {
    writeFileSync(critiquePathForRound(prdPath, 1), 'plan-digest: x\n');
    expect(await countCritiqueRounds(workspace, prdPath)).toBe(1);
  });

  it('counts a round that was committed and then deleted', async () => {
    const round1 = critiquePathForRound(prdPath, 1);
    writeFileSync(round1, 'plan-digest: x\n');
    git(workspace, 'add', '.');
    git(workspace, 'commit', '-m', 'round 1');
    git(workspace, 'rm', '-q', round1);
    git(workspace, 'commit', '-m', 'drop round 1');
    expect(await countCritiqueRounds(workspace, prdPath)).toBe(1);
  });

  it('counts both rounds', async () => {
    writeFileSync(critiquePathForRound(prdPath, 1), 'plan-digest: x\n');
    writeFileSync(critiquePathForRound(prdPath, 2), 'plan-digest: x\n');
    expect(await countCritiqueRounds(workspace, prdPath)).toBe(2);
  });

  it('falls back to the tree check when git fails', async () => {
    writeFileSync(critiquePathForRound(prdPath, 1), 'plan-digest: x\n');
    const execFileImpl = vi.fn().mockRejectedValue(new Error('git missing'));
    expect(await countCritiqueRounds(workspace, prdPath, { execFileImpl })).toBe(1);
  });

  it('loads the round 2 critique as latest and computes the current digest', async () => {
    writeFileSync(critiquePathForRound(prdPath, 1), `plan-digest: ${'1'.repeat(64)}\n`);
    writeFileSync(critiquePathForRound(prdPath, 2), `plan-digest: ${'2'.repeat(64)}\n\n## footnote: ok\n`);
    const { gateInput, prdPath: loadedPrd } = await loadCritiqueGateInput({
      workspacePath: workspace,
      issueId: 'PAN-9001',
      doc: DOC,
      required: true,
    });
    expect(loadedPrd).toBe(prdPath);
    expect(gateInput).toMatchObject({ required: true, currentDigest: planDigest(DOC), roundsUsed: 2, prdText: '# PRD\n' });
    expect(gateInput.latest?.round).toBe(2);
    expect(gateInput.latest?.critique.digest).toBe('2'.repeat(64));
  });
});

describe('isPlanFlagged', () => {
  it('reads labels case-insensitively', async () => {
    const warn = vi.fn();
    expect(await isPlanFlagged({ issueId: 'PAN-1', forced: false, getLabels: async () => ['Security'], warn })).toBe(true);
    expect(await isPlanFlagged({ issueId: 'PAN-1', forced: false, getLabels: async () => ['enhancement'], warn })).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is forced without reading labels', async () => {
    const getLabels = vi.fn();
    expect(await isPlanFlagged({ issueId: 'PAN-1', forced: true, getLabels, warn: vi.fn() })).toBe(true);
    expect(getLabels).not.toHaveBeenCalled();
  });

  it('warns once and treats the plan as unflagged when labels cannot be read', async () => {
    const warn = vi.fn();
    const getLabels = vi.fn().mockRejectedValue(new Error('gh timed out'));
    expect(await isPlanFlagged({ issueId: 'PAN-1', forced: false, getLabels, warn })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('Could not read labels for PAN-1: gh timed out');
  });
});
