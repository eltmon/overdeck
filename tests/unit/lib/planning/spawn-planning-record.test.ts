/**
 * PAN-1919: spawn-planning-session.ts seeds the per-issue record
 * instead of workspace .pan/continue.json.
 *
 * AC: A planning kickoff creates the per-issue record (initial sessionHistory)
 *     and writes no .pan/continue.json for that purpose.
 * AC: When a planning session resumes, the record returns its seeded context.
 * AC: spawn-planning-session.ts removed from CONTINUE_EXCLUDES; lint exits 0.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockQueueAutoCommit = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/lib/pan-dir/auto-commit.js', () => ({
  queueAutoCommit: mockQueueAutoCommit,
}));

// resolveProjectForIssue → null so workspace path is used as project.path
const mockResolveProjectForIssue = vi.hoisted(() => vi.fn().mockReturnValue(null));
vi.mock('../../../../src/lib/pan-dir/record.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/pan-dir/record.js')>('../../../../src/lib/pan-dir/record.js');
  return { ...actual, resolveProjectForIssue: mockResolveProjectForIssue };
});

import {
  appendSessionEntrySync,
  getProjectConfigFromWorkspacePath,
  readIssueRecordSync,
} from '../../../../src/lib/pan-dir/record.js';

describe('PAN-1919: planning kickoff seeds per-issue record', () => {
  let workspacePath: string;

  beforeEach(() => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'pan-planning-record-test-'));
    workspacePath = join(tmpRoot, 'workspaces', 'feature-pan-1919');
    mkdirSync(join(workspacePath, '.pan', 'records'), { recursive: true });
    mockQueueAutoCommit.mockClear();
    mockResolveProjectForIssue.mockReturnValue(null);
  });

  afterEach(() => {
    // no cleanup needed — tmpdir gets cleaned up by OS
  });

  it('AC1: appendSessionEntrySync writes planning entry to record, not continue.json', () => {
    const project = getProjectConfigFromWorkspacePath(workspacePath);
    appendSessionEntrySync(project, 'PAN-1919', {
      reason: 'planning',
      content: 'you are a planning agent...',
      note: 'Planning session started for PAN-1919: test issue',
      timestamp: '2026-06-21T00:00:00.000Z',
    });

    const record = readIssueRecordSync(project, 'PAN-1919');
    expect(record?.sessionHistory).toHaveLength(1);
    expect(record?.sessionHistory?.[0].reason).toBe('planning');
    expect(record?.sessionHistory?.[0].content).toBe('you are a planning agent...');

    expect(existsSync(join(workspacePath, '.pan', 'continue.json'))).toBe(false);
  });

  it('AC2: resumed planning reads seeded record context (decisions/hazards/sessionHistory)', () => {
    const project = getProjectConfigFromWorkspacePath(workspacePath);

    appendSessionEntrySync(project, 'PAN-1919', {
      reason: 'planning',
      content: 'initial planning prompt',
      timestamp: '2026-06-21T00:00:00.000Z',
    });

    const record = readIssueRecordSync(project, 'PAN-1919');
    expect(record).not.toBeNull();
    expect(record?.sessionHistory).toHaveLength(1);
    expect(record?.sessionHistory?.[0].reason).toBe('planning');
    expect(record?.sessionHistory?.[0].content).toBe('initial planning prompt');
    // decisions/hazards are absent (undefined) until explicitly written
    expect(record?.decisions ?? []).toEqual([]);
    expect(record?.hazards ?? []).toEqual([]);
  });
});
