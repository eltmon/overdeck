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
  it('appends a D-test-waived decision to .pan/continue.json (AC1/AC4)', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pan-done-waiver-'));
    const continuePath = join(workspacePath, '.pan', 'continue.json');
    mkdirSync(join(workspacePath, '.pan'), { recursive: true });
    writeFileSync(
      continuePath,
      JSON.stringify({
        version: '1',
        issueId: 'PAN-1501',
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
        decisions: [{ id: 'D1', summary: 'Existing decision', recordedAt: '2026-01-01T00:00:00.000Z' }],
        hazards: [],
        resumePoint: { description: 'test', beadId: '', filesToRead: [] },
        beadsMapping: {},
        agentModel: 'test',
        sessionHistory: [],
      }),
    );

    await recordTestWaiver(workspacePath, 'covered by existing test at abc123');

    const updated = JSON.parse(readFileSync(continuePath, 'utf-8'));
    expect(updated.decisions).toHaveLength(2);
    expect(updated.decisions[1].id).toBe('D-test-waived');
    expect(updated.decisions[1].summary).toBe(
      'Test gate waived: covered by existing test at abc123',
    );
    expect(updated.decisions[1].recordedAt).toMatch(/^\d{4}-/);
  });
});
