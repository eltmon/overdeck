import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const emit = vi.hoisted(() => vi.fn(async (_entry: { output?: string }) => 'appended'));
vi.mock('../../activity-logger.js', () => ({ emitActivityEntryOncePortable: emit }));
vi.mock('../../config.js', () => ({ getDashboardLoopbackApiUrlSync: () => 'http://127.0.0.1:3011' }));
import { reportComposerReloadProgress, runComposerReload } from '../reload.js';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'composer-reload-'));
  emit.mockClear();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

function spawnDouble(error?: Error) {
  const child = new EventEmitter() as ChildProcess;
  child.unref = vi.fn(() => child);
  const spawn = vi.fn((_args: readonly string[], _options?: SpawnOptions) => {
    queueMicrotask(() => error ? child.emit('error', error) : child.emit('spawn'));
    return child;
  });
  return { child, spawn };
}

describe('composer reload', () => {
  it('starts without an issue, survives the server, and retains the restart gate', async () => {
    vi.stubEnv('OVERDECK_AGENT_ID', 'agent-pan-42');
    vi.stubEnv('OVERDECK_ISSUE_ID', 'PAN-42');
    vi.stubEnv('DASHBOARD_URL', 'https://overdeck.localhost');
    const { child, spawn } = spawnDouble();
    const result = await runComposerReload(['reload'], { overdeckHome: home, spawnPanCli: spawn });
    expect(result).toMatchObject({ kind: 'activity', status: 'accepted', command: '/pan reload' });
    expect(spawn).toHaveBeenCalledWith(['reload', '--health-timeout', '120s'], expect.objectContaining({
      cwd: process.cwd(), detached: true,
      stdio: ['ignore', expect.any(Number), expect.any(Number)],
      env: expect.objectContaining({ OVERDECK_RESTART_INITIATOR: 'operator:composer', OVERDECK_DASHBOARD_URL: 'http://127.0.0.1:3011' }),
    }));
    const options = spawn.mock.calls[0] as unknown as [string[], { env: NodeJS.ProcessEnv }];
    expect(options[1].env.OVERDECK_AGENT_ID).toBeUndefined();
    expect(options[1].env.OVERDECK_ISSUE_ID).toBeUndefined();
    expect(options[1].env.DASHBOARD_URL).toBeUndefined();
    expect(options[0]).not.toContain('--force');
    expect(options[0]).not.toContain('--now');
    expect(child.unref).toHaveBeenCalled();
    expect(await readFile(options[1].env.OVERDECK_COMPOSER_RELOAD_LOG!, 'utf8')).toBe('');
  });

  it('preserves explicit CLI options', async () => {
    const { spawn } = spawnDouble();
    await runComposerReload(['reload', '--skip-build', '--health-timeout', '180s'], { overdeckHome: home, spawnPanCli: spawn });
    expect(spawn.mock.calls[0]?.[0]).toEqual(['reload', '--skip-build', '--health-timeout', '180s']);
  });

  it('reports spawn failure rather than claiming a background job started', async () => {
    const { spawn } = spawnDouble(new Error('spawn failed'));
    expect(await runComposerReload(['reload'], { overdeckHome: home, spawnPanCli: spawn }))
      .toMatchObject({ kind: 'captured', status: 'failed', output: 'Reload could not start: spawn failed' });
  });

  it('reports progress from the CLI and bounds failure output', async () => {
    vi.stubEnv('OVERDECK_COMPOSER_RELOAD_ACTIVITY', 'reload-123');
    const path = join(home, 'build.log');
    vi.stubEnv('OVERDECK_COMPOSER_RELOAD_LOG', path);
    await writeFile(path, 'x'.repeat(80 * 1024) + '\nBuild failed');
    await reportComposerReloadProgress('awaiting-approval', 'reload-123', path);
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'reload-123:awaiting-approval', status: 'running',
      message: 'The dashboard build is ready. Use the restart banner to put it live.',
    }));
    await reportComposerReloadProgress('failed', 'reload-123', path);
    const entry = emit.mock.calls.at(-1)?.[0] as unknown as { output: string; status: string };
    expect(entry.status).toBe('failed');
    expect(Buffer.byteLength(entry.output)).toBe(64 * 1024);
    expect(entry.output).toMatch(/Build failed$/);
    await reportComposerReloadProgress('completed', 'reload-123', path);
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'reload-123:completed', status: 'completed' }));
  });

  it('leaves terminal reloads unchanged', async () => {
    vi.stubEnv('OVERDECK_COMPOSER_RELOAD_ACTIVITY', '');
    await reportComposerReloadProgress('building');
    expect(emit).not.toHaveBeenCalled();
  });
});
