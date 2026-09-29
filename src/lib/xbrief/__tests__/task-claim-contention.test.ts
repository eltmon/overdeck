/**
 * Two-process contention test (PAN-4339 W6, FR-10, NFR-5): proves the
 * task-state lock gives exactly one of two concurrent `pan task claim`
 * processes on the same item — not "the race didn't happen to reproduce this
 * run" but a real OS-level two-process race, the only way to prove mutual
 * exclusion across processes that share no in-memory state.
 *
 * A regular test, not `.slow.test.ts`: VITEST_INCLUDE_SLOW is set nowhere in
 * `.github/`, so a slow test never gates and this coverage would be dead.
 * This is the one test in the plan that uses real time.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let planHome = '';
let overdeckHome = '';

afterEach(() => {
  for (const dir of [planHome, overdeckHome]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Run one `pan task claim`-equivalent attempt in a separate Node process:
 * acquire the task-state lock, run the real claim check with a probe that
 * sleeps 300ms (long enough that two unlocked processes would both be
 * mid-check at once regardless of start jitter) and answers 'dead' only for
 * 'agent-dead'. Exits 0 on a recorded claim, 3 on ClaimRefused, 1 on any
 * other error.
 */
function runClaimAttempt(opts: {
  planHome: string;
  lockPath: string;
  overdeckHome: string;
  me: string;
}): Promise<number> {
  const lockModulePath = resolve(import.meta.dirname, '../task-state-lock.ts');
  const claimModulePath = resolve(import.meta.dirname, '../claim-check.ts');
  const script = `
    import { withTaskStateLock } from ${JSON.stringify(lockModulePath)};
    import { claimItemChecked, ClaimRefused } from ${JSON.stringify(claimModulePath)};

    const planHome = ${JSON.stringify(opts.planHome)};
    const lockPath = ${JSON.stringify(opts.lockPath)};
    const me = ${JSON.stringify(opts.me)};

    async function main() {
      await withTaskStateLock(lockPath, () => claimItemChecked(planHome, 'PAN-1', 'a', me, {
        items: [{ id: 'a', title: 'A', status: 'pending', metadata: {} }],
        probe: async (holder) => {
          await new Promise((r) => setTimeout(r, 300));
          return holder === 'agent-dead' ? 'dead' : 'alive';
        },
      }));
    }

    main().then(
      () => process.exit(0),
      (err) => {
        if (err instanceof ClaimRefused) process.exit(3);
        console.error(err);
        process.exit(1);
      },
    );
  `;
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '--eval', script], {
      env: { ...process.env, OVERDECK_HOME: opts.overdeckHome },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
}

describe('task-state lock cross-process claim contention (PAN-4339)', () => {
  it('of two concurrent claims on the same item, exactly one succeeds and the continue file names the winner', async () => {
    planHome = mkdtempSync(join(tmpdir(), 'task-claim-contention-plan-home-'));
    overdeckHome = mkdtempSync(join(tmpdir(), 'task-claim-contention-overdeck-home-'));

    const continuesDir = join(planHome, '.pan', 'continues');
    mkdirSync(continuesDir, { recursive: true });
    const continuePath = join(continuesDir, 'PAN-1.xbrief.json');
    writeFileSync(
      continuePath,
      JSON.stringify({
        version: '1',
        issueId: 'PAN-1',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        gitState: {},
        decisions: [],
        hazards: [],
        resumePoint: null,
        sessionHistory: [],
        items: { a: { status: 'in_progress', claimedBy: 'agent-dead' } },
      }),
    );
    const lockPath = join(planHome, 'overdeck-task-state.lock');

    const [oneExit, twoExit] = await Promise.all([
      runClaimAttempt({ planHome, lockPath, overdeckHome, me: 'agent-one' }),
      runClaimAttempt({ planHome, lockPath, overdeckHome, me: 'agent-two' }),
    ]);

    expect([oneExit, twoExit].sort()).toEqual([0, 3]);

    const finalState = JSON.parse(readFileSync(continuePath, 'utf-8')) as {
      items: { a: { claimedBy: string } };
    };
    const winner = oneExit === 0 ? 'agent-one' : 'agent-two';
    expect(finalState.items.a.claimedBy).toBe(winner);
  }, 30_000);
});
