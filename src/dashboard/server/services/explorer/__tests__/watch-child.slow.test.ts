/**
 * Real-process check of the explorer watcher (PAN-5183, D-A16): a real
 * supervisor forks the real child, which runs real @parcel/watcher.
 * Slow (tsx startup, real timers): runs only with VITEST_INCLUDE_SLOW=1.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExplorerWatchEvent } from '@overdeck/contracts';
import { createExplorerWatchSupervisor, type ExplorerWatchSupervisor } from '../watch-supervisor.js';

const CHILD_SCRIPT = fileURLToPath(new URL('../watch-child.ts', import.meta.url));

let supervisor: ExplorerWatchSupervisor | null = null;
let dir: string | null = null;

afterEach(async () => {
  await supervisor?.dispose();
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function until(check: () => boolean, timeoutMs: number, step: () => Promise<void> = async () => {}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await step();
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('explorer watcher child (real process)', () => {
  it('delivers a create event within 500 ms and loads watcher.node only in the child', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'explorer-slow-')));
    let child: ChildProcess | null = null;
    supervisor = createExplorerWatchSupervisor({
      scriptPath: CHILD_SCRIPT,
      execArgv: ['--import', 'tsx'],
      listTopLevelIgnored: async () => [],
      fork: ((...args: Parameters<typeof fork>) => {
        child = fork(...args);
        return child;
      }) as typeof fork,
    });

    const events: ExplorerWatchEvent[] = [];
    await supervisor.subscribe({ id: 'issue:SLOW-1', absPath: dir, kind: 'issue' }, (batch) => events.push(...batch));

    // subscribe() resolves when `watch` is sent, not when parcel is live: probe until an event arrives.
    let probe = 0;
    await until(
      () => events.length > 0,
      20_000,
      async () => {
        probe += 1;
        await writeFile(join(dir!, `probe-${probe}.txt`), 'p');
      },
    );

    events.length = 0;
    const wroteAt = Date.now();
    await writeFile(join(dir, 'new.txt'), 'x');
    await until(() => events.some((e) => e.kind === 'create' && e.path === 'new.txt'), 2000);
    expect(Date.now() - wroteAt).toBeLessThan(500);

    if (process.platform === 'linux') {
      expect(child).not.toBeNull();
      const childMaps = await readFile(`/proc/${(child as unknown as ChildProcess).pid}/maps`, 'utf8');
      expect(childMaps).toContain('watcher.node');
      expect(await readFile('/proc/self/maps', 'utf8')).not.toContain('watcher.node');
    }
  }, 30_000);
});
