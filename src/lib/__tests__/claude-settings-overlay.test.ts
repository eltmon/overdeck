import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';

import { injectPanopticonInfraDeny } from '../claude-settings-overlay.js';

const tempDirs: string[] = [];

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pan-settings-overlay-'));
  tempDirs.push(dir);
  return dir;
}

async function readSettings(workspace: string): Promise<Record<string, unknown>> {
  const content = await readFile(join(workspace, '.claude', 'settings.local.json'), 'utf-8');
  return JSON.parse(content) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('injectPanopticonInfraDeny', () => {
  it('denies tmux session input commands idempotently while preserving existing permissions', async () => {
    const workspace = await makeTempWorkspace();
    const claudeDir = join(workspace, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, 'settings.local.json'),
      JSON.stringify({ permissions: { deny: ['Bash(existing:*)'] }, other: true }, null, 2),
    );

    await injectPanopticonInfraDeny(workspace);
    await injectPanopticonInfraDeny(workspace);

    const settings = await readSettings(workspace);
    expect(settings.other).toBe(true);
    const deny = (settings.permissions as { deny: string[] }).deny;

    expect(deny).toEqual(expect.arrayContaining([
      'Bash(existing:*)',
      'Bash(tmux send-keys:*)',
      'Bash(tmux -L panopticon send-keys:*)',
      'Bash(tmux paste-buffer:*)',
      'Bash(tmux -L panopticon paste-buffer:*)',
    ]));
    expect(deny.filter(pattern => pattern === 'Bash(tmux send-keys:*)')).toHaveLength(1);
  });
});
