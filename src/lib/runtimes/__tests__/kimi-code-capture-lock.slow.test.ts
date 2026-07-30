/**
 * @slow Real multi-process contention coverage; excluded from the default
 * Vitest run (set VITEST_INCLUDE_SLOW=1 to include it).
 *
 * PAN-1837 review fix (cycle 7): withKimiSessionCaptureLock() is a
 * cross-process filesystem lock precisely because the four Kimi launch
 * owners (pan start/strike's CLI process, dashboard conversations in the
 * server process, and Deacon recovery/restart in its child process) share
 * no in-memory state. An in-process test proves nothing about that — it
 * only exercises one Node process's module state. This spawns two REAL
 * separate Node child processes contending for the same workDirKey bucket.
 *
 * Proving "the race didn't happen to reproduce this run" is not the same as
 * proving mutual exclusion, and real process scheduling jitter means a
 * session-id-capture race is not guaranteed to manifest on every run even
 * without the lock. So the primary assertion here is deterministic: each
 * child logs a start/end timestamp pair to a shared file while holding the
 * lock; if the lock provides real cross-process mutual exclusion, sorting
 * the combined log by time must show one child's (start, end) pair fully
 * before the other's, never interleaved. The secondary assertion — each
 * child's own session id is the one persisted for its own identity — proves
 * the fix's actual purpose (correct attribution), on top of that ordering
 * guarantee.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let overdeckHome = '';
let kimiHome = '';
let workspace = '';

afterEach(() => {
  for (const dir of [overdeckHome, kimiHome, workspace]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Run one "Kimi launch" in a separate child process: acquire the shared
 * capture lock, append a start-timestamp line to the shared order log,
 * sleep (simulating the real gap between tmux-session-created and
 * Kimi-writes-its-session-dir — long enough that two unlocked children
 * would overlap during it regardless of process-start jitter), snapshot the
 * bucket, write a wire.jsonl fixture for `sessionId`, poll for and capture
 * the new session directory, append an end-timestamp line, and persist the
 * captured id to `<overdeckHome>/agents/<identityId>/kimi-session-id`.
 * Exits 0 on success, 1 on any exception.
 */
function runKimiLaunch(opts: {
  overdeckHome: string;
  kimiHome: string;
  workspace: string;
  orderLogPath: string;
  identityId: string;
  sessionId: string;
}): Promise<number> {
  const modulePath = resolve(import.meta.dirname, '../kimi-code.ts');
  const script = `
    import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
    import { readdir } from 'node:fs/promises';
    import { join } from 'node:path';
    import {
      withKimiSessionCaptureLock,
      waitForNewKimiSessionAsync,
      writeKimiSessionId,
      kimiSessionsRoot,
    } from ${JSON.stringify(modulePath)};

    const kimiHome = ${JSON.stringify(opts.kimiHome)};
    const workspace = ${JSON.stringify(opts.workspace)};
    const identityId = ${JSON.stringify(opts.identityId)};
    const sessionId = ${JSON.stringify(opts.sessionId)};
    const overdeckHome = ${JSON.stringify(opts.overdeckHome)};
    const orderLogPath = ${JSON.stringify(opts.orderLogPath)};
    const bucketDir = kimiSessionsRoot(kimiHome, workspace);

    function log(event) {
      appendFileSync(orderLogPath, identityId + ' ' + event + ' ' + Date.now() + '\\n');
    }

    async function main() {
      const captured = await withKimiSessionCaptureLock(kimiHome, workspace, async () => {
        log('start');
        let existingBefore;
        try {
          existingBefore = new Set(await readdir(bucketDir));
        } catch {
          existingBefore = new Set();
        }
        // Long enough that two unlocked processes started together would
        // both be mid-flight here regardless of OS scheduling jitter.
        await new Promise((r) => setTimeout(r, 1000));
        const wireDir = join(bucketDir, sessionId, 'agents', 'main');
        mkdirSync(wireDir, { recursive: true });
        writeFileSync(join(wireDir, 'wire.jsonl'), '{"type":"metadata"}\\n');
        const result = await waitForNewKimiSessionAsync(kimiHome, workspace, existingBefore, 10_000);
        log('end');
        return result;
      });
      if (!captured) throw new Error('capture returned null');
      mkdirSync(join(overdeckHome, 'agents', identityId), { recursive: true });
      writeKimiSessionId(identityId, captured, overdeckHome);
    }

    main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
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

interface OrderEvent {
  identityId: string;
  event: 'start' | 'end';
  ts: number;
}

function parseOrderLog(path: string): OrderEvent[] {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [identityId, event, ts] = line.split(' ');
      return { identityId, event: event as 'start' | 'end', ts: Number(ts) };
    })
    .sort((a, b) => a.ts - b.ts);
}

describe('@slow withKimiSessionCaptureLock cross-process contention (PAN-1837 review fix)', () => {
  it('serializes two separate processes launching the same cwd (no interleaved start/end) and pins each its own session id', async () => {
    overdeckHome = mkdtempSync(join(tmpdir(), 'kimi-lock-overdeck-home-'));
    kimiHome = mkdtempSync(join(tmpdir(), 'kimi-lock-kimi-home-'));
    workspace = mkdtempSync(join(tmpdir(), 'kimi-lock-workspace-'));
    const orderLogPath = join(overdeckHome, 'order.log');

    const [workExit, conversationExit] = await Promise.all([
      runKimiLaunch({ overdeckHome, kimiHome, workspace, orderLogPath, identityId: 'agent-work-proc', sessionId: 'session_work_proc' }),
      runKimiLaunch({ overdeckHome, kimiHome, workspace, orderLogPath, identityId: 'conv-proc', sessionId: 'session_conversation_proc' }),
    ]);

    expect(workExit).toBe(0);
    expect(conversationExit).toBe(0);

    // Mutual exclusion, proven directly: one identity's (start, end) pair
    // must be fully resolved before the other's starts. Interleaving here
    // (A-start, B-start, A-end, ...) would mean two processes held the
    // "lock" at once — exactly the cross-process race this fix closes.
    const events = parseOrderLog(orderLogPath);
    expect(events).toHaveLength(4);
    expect(events[0].event).toBe('start');
    expect(events[1].identityId).toBe(events[0].identityId);
    expect(events[1].event).toBe('end');
    expect(events[2].identityId).not.toBe(events[0].identityId);
    expect(events[2].event).toBe('start');
    expect(events[3].identityId).toBe(events[2].identityId);
    expect(events[3].event).toBe('end');

    // Correct attribution: each identity's own launch persisted its own id,
    // not the other's.
    const workCaptured = readFileSync(join(overdeckHome, 'agents', 'agent-work-proc', 'kimi-session-id'), 'utf-8').trim();
    const conversationCaptured = readFileSync(join(overdeckHome, 'agents', 'conv-proc', 'kimi-session-id'), 'utf-8').trim();
    expect(workCaptured).toBe('session_work_proc');
    expect(conversationCaptured).toBe('session_conversation_proc');
  }, 30_000);
});
