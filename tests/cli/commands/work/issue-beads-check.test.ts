/**
 * Tests for hasBeadsTasks — the beads enforcement check in pan start (PAN-336)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const childProcessMocks = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock('child_process', () => childProcessMocks);

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pan-issue-test-'));
  childProcessMocks.execFileSync.mockImplementation(() => {
    throw new Error('bd unavailable');
  });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('hasBeadsTasks', () => {
  it('returns false when .beads directory does not exist', async () => {
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/start.js');
    expect(hasBeadsTasks(tmpDir, 'PAN-1094')).toBe(false);
  });

  it('returns false when .beads exists without exported issues', async () => {
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/start.js');
    mkdirSync(join(tmpDir, '.beads'));
    expect(hasBeadsTasks(tmpDir, 'PAN-1094')).toBe(false);
  });

  it('returns false when issues.jsonl only contains beads for another issue', async () => {
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/start.js');
    mkdirSync(join(tmpDir, '.beads'), { recursive: true });
    writeFileSync(join(tmpDir, '.beads', 'issues.jsonl'), JSON.stringify({
      id: 'panopticon-1',
      title: 'PAN-1093: Task',
      labels: ['pan-1093'],
    }) + '\n');

    expect(hasBeadsTasks(tmpDir, 'PAN-1094')).toBe(false);
  });

  it('returns true when issues.jsonl contains a bead labeled for the issue', async () => {
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/start.js');
    mkdirSync(join(tmpDir, '.beads'), { recursive: true });
    writeFileSync(join(tmpDir, '.beads', 'issues.jsonl'), JSON.stringify({
      id: 'panopticon-2',
      title: 'PAN-1094: Task',
      labels: ['pan-1094'],
    }) + '\n');

    expect(hasBeadsTasks(tmpDir, 'PAN-1094')).toBe(true);
  });

  it('returns true when bd reports a matching issue bead', async () => {
    childProcessMocks.execFileSync.mockImplementation(() => JSON.stringify([{ id: 'panopticon-3' }]));
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/start.js');

    expect(hasBeadsTasks(tmpDir, 'PAN-1094')).toBe(true);
    expect(childProcessMocks.execFileSync).toHaveBeenCalledWith(
      'bd',
      ['list', '--json', '-l', 'pan-1094', '--status', 'all', '--limit', '0'],
      expect.objectContaining({ cwd: tmpDir }),
    );
  });

  it('detects when beads do not cover every vBRIEF item', async () => {
    const { validateBeadsMatchPlan } = await import('../../../../src/cli/commands/start.js');
    const workspace = join(tmpDir, 'workspaces', 'feature-pan-1094');
    mkdirSync(join(workspace, '.pan'), { recursive: true });
    mkdirSync(join(workspace, '.beads'), { recursive: true });
    writeFileSync(join(workspace, '.pan', 'spec.vbrief.json'), JSON.stringify({
      vBRIEFInfo: { version: '0.5', created: '2026-05-16T00:00:00Z' },
      plan: {
        id: 'PAN-1094',
        title: 'Test plan',
        status: 'proposed',
        items: [
          { id: 'one', title: 'One', status: 'pending' },
          { id: 'two', title: 'Two', status: 'pending' },
        ],
        edges: [],
      },
    }));
    writeFileSync(join(workspace, '.beads', 'issues.jsonl'), JSON.stringify({
      id: 'panopticon-2',
      title: 'PAN-1094: One',
      labels: ['pan-1094'],
    }) + '\n');

    expect(validateBeadsMatchPlan(workspace, 'PAN-1094')).toEqual({
      valid: false,
      beadCount: 1,
      planItemCount: 2,
    });
  });
});
