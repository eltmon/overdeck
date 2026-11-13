/**
 * Self-test for the spawn ledger (tests/helpers/spawn-budget.ts, PAN-5176).
 *
 * The ledger is installed in vi.hoisted, before the static imports below, as
 * every ledger test file must do. No step here depends on time, so the file
 * uses no fake timers. `true` is the harmless program: it lives in /usr/bin or
 * /bin on both macOS and Linux.
 */
import { exec, execFile, execFileSync, type ExecFileException } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { ChildProcess } from 'effect/unstable/process';
import * as NodeServices from '@effect/platform-node/NodeServices';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectSpawnBudget, spawnsPerTick } from '../../helpers/spawn-budget.js';

const ledger = await vi.hoisted(async () =>
  (await import('../../helpers/spawn-budget.js')).installSpawnLedger());

const execFileAsync = promisify(execFile);

afterAll(() => {
  ledger.restore();
});

beforeEach(() => {
  ledger.reset();
});

describe('spawn ledger', () => {
  it('(a) records a promisify(execFile) call once', async () => {
    await execFileAsync('true', []);
    expect(ledger.records).toEqual([{ api: 'execFile', program: 'true', denied: false }]);
  });

  it('(b) records exec once, not again for its nested execFile', async () => {
    await new Promise<void>((resolve, reject) => {
      exec('true', (error) => (error ? reject(error) : resolve()));
    });
    expect(ledger.records).toEqual([{ api: 'exec', program: 'true', denied: false }]);
  });

  it('(c) records one spawn for an Effect ChildProcess.make under NodeServices.layer', async () => {
    const exitCode = await Effect.runPromise(
      Effect.scoped(Effect.gen(function* () {
        const handle = yield* ChildProcess.make('true', []);
        return yield* handle.exitCode;
      })).pipe(Effect.provide(NodeServices.layer)),
    );
    expect(Number(exitCode)).toBe(0);
    expect(ledger.records).toEqual([{ api: 'spawn', program: 'true', denied: false }]);
  });

  it('(d) denies execFile("tmux") with a real ENOENT', async () => {
    const error = await new Promise<ExecFileException | null>((resolve) => {
      execFile('tmux', ['-V'], (err) => resolve(err));
    });
    expect(error?.code).toBe('ENOENT');
    expect(ledger.records).toEqual([{ api: 'execFile', program: 'tmux', denied: true }]);
  });

  it('(e) denies execFileSync("docker") with a thrown ENOENT', () => {
    let thrown: unknown;
    try {
      execFileSync('docker', ['ps']);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'ENOENT' });
    expect(ledger.records).toEqual([{ api: 'execFileSync', program: 'docker', denied: true }]);
  });

  it('(g) spawnsPerTick rejects with the error of a rejecting tick', async () => {
    const failure = new Error('tick broke before reaching child_process');
    await expect(spawnsPerTick(ledger, async () => { throw failure; }, { ticks: 3 })).rejects.toBe(failure);
  });

  it('spawnsPerTick counts each tick separately and expectSpawnBudget passes within budget', async () => {
    const perTick = await spawnsPerTick(ledger, () => execFileAsync('true', []), {
      ticks: 2,
      betweenTicks: async () => {},
      programs: ['true'],
    });
    expect(perTick).toEqual([1, 1]);
    expectSpawnBudget(perTick, { max: 1, label: 'true poller' });
    expect(() => expectSpawnBudget(perTick, { max: 0, label: 'true poller' })).toThrow(/true poller: tick 0/);
  });

  // Runs last: restore() is permanent for this file's ledger.
  it('(f) records nothing after restore()', async () => {
    ledger.restore();
    await execFileAsync('true', []);
    await new Promise<void>((resolve, reject) => {
      execFile('true', (error) => (error ? reject(error) : resolve()));
    });
    expect(ledger.records).toHaveLength(0);
  });
});
