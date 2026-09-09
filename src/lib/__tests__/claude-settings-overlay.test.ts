import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';

import { injectOverdeckInfraDeny } from '../claude-settings-overlay.js';

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

describe('injectOverdeckInfraDeny', () => {
  it('is a compatibility no-op that preserves native settings byte-for-byte', async () => {
    const workspace = await makeTempWorkspace();
    const claudeDir = join(workspace, '.claude');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(claudeDir, 'settings.local.json'),
      JSON.stringify({ permissions: { deny: ['Bash(existing:*)'] }, other: true }, null, 2),
    );

    await Effect.runPromise(injectOverdeckInfraDeny(workspace));
    await Effect.runPromise(injectOverdeckInfraDeny(workspace));

    expect(await readFile(join(claudeDir, 'settings.local.json'), 'utf8')).toBe(
      JSON.stringify({ permissions: { deny: ['Bash(existing:*)'] }, other: true }, null, 2),
    );
  });
});
