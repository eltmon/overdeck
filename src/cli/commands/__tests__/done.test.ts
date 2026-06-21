import { execFile } from 'child_process';
import { promisify } from 'util';
import { describe, expect, it } from 'vitest';
import { join } from 'path';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { augmentCommentWithWaiver, recordTestWaiver, verifyStrikeBranchMergedIntoMain } from '../done.js';
import { getProjectConfigFromWorkspacePath, readIssueRecordSync, writeIssueRecordSync } from '../../../lib/pan-dir/record.js';

const execFileAsync = promisify(execFile);
const CLI = join(process.cwd(), 'dist', 'cli', 'index.js');

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

async function createStrikeRepo(issueId = 'PAN-2013'): Promise<{ projectPath: string }> {
  const root = mkdtempSync(join(tmpdir(), 'pan-strike-merged-'));
  const remotePath = join(root, 'remote.git');
  const projectPath = join(root, 'project');

  await execFileAsync('git', ['init', '--bare', remotePath]);
  mkdirSync(projectPath);
  await git(projectPath, ['init', '-b', 'main']);
  await git(projectPath, ['config', 'user.email', 'test@example.com']);
  await git(projectPath, ['config', 'user.name', 'Test User']);
  writeFileSync(join(projectPath, 'README.md'), 'base\n');
  await git(projectPath, ['add', 'README.md']);
  await git(projectPath, ['commit', '-m', 'initial']);
  await git(projectPath, ['branch', `strike/${issueId.toLowerCase()}`]);
  await git(projectPath, ['remote', 'add', 'origin', remotePath]);
  await git(projectPath, ['push', '-u', 'origin', 'main']);

  return { projectPath };
}

describe('pan done CLI options', () => {
  it('lists --test-waived in pan done --help (AC1)', async () => {
    const { stdout } = await execFileAsync('node', [CLI, 'done', '--help']);
    expect(stdout).toContain('--test-waived <reason>');
    expect(stdout).toContain('Skip the test-requirement gate');
  });

  it('rejects --test-waived without a reason (AC4)', async () => {
    await expect(execFileAsync('node', [CLI, 'done', 'PAN-1501', '--test-waived'])).rejects.toThrow(
      /error: option '--test-waived <reason>' argument missing/i,
    );
  });
});

describe('augmentCommentWithWaiver', () => {
  it('sets the comment to the waiver text when no comment is provided (AC2)', () => {
    expect(augmentCommentWithWaiver(undefined, 'covered by abc123')).toBe(
      'Test gate waived: covered by abc123',
    );
  });

  it('appends the waiver to an existing comment with a blank line separator (AC3)', () => {
    expect(augmentCommentWithWaiver('Initial comment', 'covered by abc123')).toBe(
      'Initial comment\n\nTest gate waived: covered by abc123',
    );
  });
});

describe('recordTestWaiver', () => {
  it('appends a D-test-waived decision to the per-issue record (AC1/AC4)', async () => {
    // Workspace path must end in feature-pan-<N> for issueId detection
    const workspace = mkdtempSync(join(tmpdir(), 'pan-done-waiver-feature-pan-1501-'));
    const workspacePath = join(workspace, 'feature-pan-1501');
    mkdirSync(join(workspacePath, '.pan'), { recursive: true });
    const project = getProjectConfigFromWorkspacePath(workspacePath);
    const now = '2026-01-01T00:00:00.000Z';
    writeIssueRecordSync(project, 'PAN-1501', {
      issueId: 'PAN-1501',
      schemaVersion: 2,
      created: now,
      updated: now,
      decisions: [{ id: 'D1', summary: 'Existing decision', recordedAt: now }],
      hazards: [],
      resumePoint: null,
      beadsMapping: {},
      statusOverrides: {},
      sessionHistory: [],
      feedback: [],
      pipeline: null,
      closeOut: null,
    });

    await recordTestWaiver(workspacePath, 'covered by existing test at abc123');

    const updated = readIssueRecordSync(project, 'PAN-1501');
    expect(updated?.decisions).toHaveLength(2);
    expect(updated?.decisions[1].id).toBe('D-test-waived');
    expect(updated?.decisions[1].summary).toBe(
      'Test gate waived: covered by existing test at abc123',
    );
    expect(updated?.decisions[1].recordedAt).toMatch(/^\d{4}-/);
    rmSync(workspace, { recursive: true, force: true });
  });
});

describe('verifyStrikeBranchMergedIntoMain', () => {
  it('accepts a strike branch contained in origin/main', async () => {
    const { projectPath } = await createStrikeRepo();

    await expect(verifyStrikeBranchMergedIntoMain('PAN-2013', projectPath)).resolves.toBe(
      'strike/pan-2013 is contained in origin/main',
    );
  });

  it('rejects a strike branch that has not landed on origin/main', async () => {
    const { projectPath } = await createStrikeRepo();

    await git(projectPath, ['checkout', 'strike/pan-2013']);
    writeFileSync(join(projectPath, 'strike.txt'), 'unmerged\n');
    await git(projectPath, ['add', 'strike.txt']);
    await git(projectPath, ['commit', '-m', 'strike work']);

    await expect(verifyStrikeBranchMergedIntoMain('PAN-2013', projectPath)).rejects.toThrow();
  });
});
