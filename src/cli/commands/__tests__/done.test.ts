import { execFile } from 'child_process';
import { promisify } from 'util';
import { describe, expect, it } from 'vitest';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { augmentCommentWithWaiver, recordTestWaiver } from '../done.js';

const execFileAsync = promisify(execFile);
const CLI = join(process.cwd(), 'dist', 'cli', 'index.js');

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
    const base = mkdtempSync(join(tmpdir(), 'pan-done-waiver-'));
    const workspacePath = join(base, 'feature-pan-1501');
    const recordPath = join(workspacePath, '.pan', 'records', 'pan-1501.json');
    mkdirSync(join(workspacePath, '.pan', 'records'), { recursive: true });

    await recordTestWaiver(workspacePath, 'covered by existing test at abc123');

    const updated = JSON.parse(readFileSync(recordPath, 'utf-8'));
    expect(updated.decisions).toHaveLength(1);
    expect(updated.decisions[0].id).toBe('D-test-waived');
    expect(updated.decisions[0].summary).toBe(
      'Test gate waived: covered by existing test at abc123',
    );
    expect(updated.decisions[0].recordedAt).toMatch(/^\d{4}-/);
  });
});
