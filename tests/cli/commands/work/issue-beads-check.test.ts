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
      ['list', '--json', '-l', 'pan-1094', '--status', 'all', '--limit', '1'],
      expect.objectContaining({ cwd: tmpDir }),
    );
  });
});
