import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { beforeAll, describe, expect, it } from 'vitest';
import { join } from 'path';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { augmentCommentWithWaiver, recordTestWaiver } from '../done.js';
import { buildStrikeBypassStamp, verifyStrikeBranchMergedIntoMain } from '../strike-merge-verification.js';
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
  beforeAll(() => {
    if (!existsSync(CLI)) {
      execSync('npm run build:cli', { cwd: process.cwd(), stdio: 'pipe', timeout: 300_000 });
    }
    if (!existsSync(CLI)) {
      throw new Error(`CLI dist missing after build:cli: ${CLI}`);
    }
  }, 310_000);

  it('lists --test-waived in pan done --help (AC1)', () => {
    const output = execFileSync('node', [CLI, 'done', '--help'], { encoding: 'utf8' });
    expect(output).toContain('--test-waived <reason>');
    expect(output).toContain('Skip the test-requirement gate');
  });

  it('rejects --test-waived without a reason (AC4)', () => {
    expect(() => execFileSync('node', [CLI, 'done', 'PAN-1501', '--test-waived'])).toThrow(
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
      tasksMapping: {},
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

  it('accepts a squash-merged strike branch with equivalent commits on origin/main', async () => {
    const { projectPath } = await createStrikeRepo();

    await git(projectPath, ['checkout', 'strike/pan-2013']);
    writeFileSync(join(projectPath, 'strike.txt'), 'squash merged\n');
    await git(projectPath, ['add', 'strike.txt']);
    await git(projectPath, ['commit', '-m', 'strike work']);
    await git(projectPath, ['checkout', 'main']);
    await git(projectPath, ['merge', '--squash', 'strike/pan-2013']);
    await git(projectPath, ['commit', '-m', 'squash strike work']);
    await git(projectPath, ['push', 'origin', 'main']);

    await expect(verifyStrikeBranchMergedIntoMain('PAN-2013', projectPath)).resolves.toBe(
      'strike/pan-2013 has no commits missing from origin/main',
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

  it('accepts a strike branch whose content landed under a different commit (PAN-3326)', async () => {
    const { projectPath } = await createStrikeRepo();

    // The strike commit carries the fix on its own.
    await git(projectPath, ['checkout', 'strike/pan-2013']);
    writeFileSync(join(projectPath, 'strike.txt'), 'the fix\n');
    await git(projectPath, ['add', 'strike.txt']);
    await git(projectPath, ['commit', '-m', 'strike work']);

    // main gets the same content via a commit that also touches another file, so
    // the patch-ids differ and `git cherry` reports the strike commit as missing.
    await git(projectPath, ['checkout', 'main']);
    writeFileSync(join(projectPath, 'strike.txt'), 'the fix\n');
    writeFileSync(join(projectPath, 'unrelated.txt'), 'rode along\n');
    await git(projectPath, ['add', 'strike.txt', 'unrelated.txt']);
    await git(projectPath, ['commit', '-m', 'same fix landed by another route']);
    await git(projectPath, ['push', 'origin', 'main']);

    await expect(verifyStrikeBranchMergedIntoMain('PAN-2013', projectPath)).resolves.toContain(
      'has no unlanded content on origin/main',
    );
  });

  it('accepts a fix plus fixup that landed as one squashed commit (PAN-3326)', async () => {
    const { projectPath } = await createStrikeRepo();

    // Two commits on the branch: the second supersedes the first, so neither
    // commit's own tree matches main — only the branch tip does.
    await git(projectPath, ['checkout', 'strike/pan-2013']);
    writeFileSync(join(projectPath, 'strike.txt'), 'first pass\n');
    await git(projectPath, ['add', 'strike.txt']);
    await git(projectPath, ['commit', '-m', 'strike work']);
    writeFileSync(join(projectPath, 'strike.txt'), 'final\n');
    await git(projectPath, ['add', 'strike.txt']);
    await git(projectPath, ['commit', '-m', 'strike fixup']);

    // main carries the combined result under a single commit that also touches
    // another file, so no patch-id on the branch matches anything upstream.
    await git(projectPath, ['checkout', 'main']);
    writeFileSync(join(projectPath, 'strike.txt'), 'final\n');
    writeFileSync(join(projectPath, 'unrelated.txt'), 'rode along\n');
    await git(projectPath, ['add', 'strike.txt', 'unrelated.txt']);
    await git(projectPath, ['commit', '-m', 'combined result landed elsewhere']);
    await git(projectPath, ['push', 'origin', 'main']);

    await expect(verifyStrikeBranchMergedIntoMain('PAN-2013', projectPath)).resolves.toContain(
      'has no unlanded content on origin/main',
    );
  });

  it('names the unlanded commit and paths when content really is missing (PAN-3326)', async () => {
    const { projectPath } = await createStrikeRepo();

    await git(projectPath, ['checkout', 'strike/pan-2013']);
    writeFileSync(join(projectPath, 'strike.txt'), 'never landed\n');
    await git(projectPath, ['add', 'strike.txt']);
    await git(projectPath, ['commit', '-m', 'strike work']);

    await expect(verifyStrikeBranchMergedIntoMain('PAN-2013', projectPath)).rejects.toThrow(
      /strike\.txt/,
    );
  });
});

describe('buildStrikeBypassStamp (PAN-3067)', () => {
  it('stamps verification and tests as skipped when no review status exists', () => {
    const stamp = buildStrikeBypassStamp(null);
    expect(stamp.verificationStatus).toBe('skipped');
    expect(stamp.verificationNotes).toContain('bypassed by design');
    expect(stamp.testStatus).toBe('skipped');
    expect(stamp.testNotes).toContain('by design');
  });

  it('stamps only the missing verdicts when tests already passed', () => {
    const stamp = buildStrikeBypassStamp({ testStatus: 'passed', verificationStatus: 'pending' });
    expect(stamp.verificationStatus).toBe('skipped');
    expect(stamp.testStatus).toBeUndefined();
    expect(stamp.testNotes).toBeUndefined();
  });

  it('leaves already-terminal verdicts untouched', () => {
    expect(buildStrikeBypassStamp({ testStatus: 'skipped', verificationStatus: 'passed' })).toEqual({});
    expect(buildStrikeBypassStamp({ testStatus: 'passed', verificationStatus: 'skipped' })).toEqual({});
  });
});
