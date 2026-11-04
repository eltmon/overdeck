/** PAN-4655 WI-3: the idle-settle sweep decides from an injected clock and fake IO over a real temp database. */
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdleSettleDeps } from '../conversation-idle-settle.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.parse('2026-11-01T12:00:00.000Z');

let testHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4655-idle-settle-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

/** A conversation created and last attached `ageMs` before NOW. */
async function createOld(name: string, ageMs: number, parentName?: string): Promise<void> {
  const { createConversation } = await import('../conversations.js');
  const { getOverdeckDatabase } = await import('../infra.js');
  createConversation({ name, tmuxSession: name, cwd: testHome, harness: 'claude-code', ...(parentName ? { parentName } : {}) });
  getOverdeckDatabase()
    .prepare('UPDATE conversations SET created_at = ?, last_attached_at = ? WHERE name = ?')
    .run(NOW - ageMs, NOW - ageMs, name);
}

async function setColumn(name: string, column: string, value: number | string): Promise<void> {
  const { getOverdeckDatabase } = await import('../infra.js');
  getOverdeckDatabase().prepare(`UPDATE conversations SET ${column} = ? WHERE name = ?`).run(value, name);
}

async function settleReasonOf(name: string): Promise<string | null> {
  const { getConversationTriage } = await import('../conversation-triage-store.js');
  return getConversationTriage(name)?.settleReason ?? null;
}

interface FakeIo {
  deps: IdleSettleDeps;
  /** Transcript activity by conversation name; absent = 10 days old. */
  activity: Map<string, number>;
  live: Set<string>;
  waiting: Set<string>;
  /** Names whose transcript cannot be resolved. */
  noTranscript: Set<string>;
}

function fakeIo(overrides: Partial<IdleSettleDeps> = {}): FakeIo {
  const activity = new Map<string, number>();
  const live = new Set<string>();
  const waiting = new Set<string>();
  const noTranscript = new Set<string>();
  const deps: IdleSettleDeps = {
    now: () => NOW,
    idleDays: () => 3,
    listLiveSessions: vi.fn(async () => live),
    listWaitingNames: vi.fn(async () => waiting),
    resolveTranscript: vi.fn(async (conv) => (noTranscript.has(conv.name) ? null : `/transcripts/${conv.name}.jsonl`)),
    lastActivityMs: vi.fn(async (path: string) => {
      const name = path.slice('/transcripts/'.length, -'.jsonl'.length);
      return activity.get(name) ?? NOW - 10 * DAY;
    }),
    log: () => {},
    ...overrides,
  };
  return { deps, activity, live, waiting, noTranscript };
}

describe('sweepIdleConversations', () => {
  it('settles a root idle for 3 days and leaves one idle for 2 days', async () => {
    const { sweepIdleConversations } = await import('../conversation-idle-settle.js');
    await createOld('conv-old', 10 * DAY);
    await createOld('conv-recent', 10 * DAY);
    const io = fakeIo();
    io.activity.set('conv-old', NOW - 3 * DAY);
    io.activity.set('conv-recent', NOW - 2 * DAY);

    expect(await sweepIdleConversations(io.deps)).toEqual(['conv-old']);
    expect(await settleReasonOf('conv-old')).toBe('idle');
    expect(await settleReasonOf('conv-recent')).toBeNull();
  });

  it('leaves a root whose last attach is newer than the cutoff', async () => {
    const { sweepIdleConversations } = await import('../conversation-idle-settle.js');
    await createOld('conv-attached', 10 * DAY);
    await setColumn('conv-attached', 'last_attached_at', NOW - DAY);
    const io = fakeIo();

    expect(await sweepIdleConversations(io.deps)).toEqual([]);
    expect(io.deps.listLiveSessions).not.toHaveBeenCalled();
  });

  it('does nothing and reads nothing when idle days is 0', async () => {
    const { sweepIdleConversations } = await import('../conversation-idle-settle.js');
    await createOld('conv-off', 10 * DAY);
    const io = fakeIo({ idleDays: () => 0 });

    expect(await sweepIdleConversations(io.deps)).toEqual([]);
    expect(io.deps.listLiveSessions).not.toHaveBeenCalled();
    expect(io.deps.resolveTranscript).not.toHaveBeenCalled();
    expect(io.deps.lastActivityMs).not.toHaveBeenCalled();
    expect(await settleReasonOf('conv-off')).toBeNull();
  });

  it('restarts the idle clock when the operator unsettles', async () => {
    const { sweepIdleConversations } = await import('../conversation-idle-settle.js');
    const { unsettleConversation } = await import('../conversation-triage-store.js');
    await createOld('conv-back', 10 * DAY);
    const unsettledAt = NOW + HOUR;

    expect(await sweepIdleConversations(fakeIo().deps)).toEqual(['conv-back']);
    unsettleConversation('conv-back', unsettledAt);

    expect(await sweepIdleConversations(fakeIo({ now: () => unsettledAt + 2 * DAY }).deps)).toEqual([]);
    expect(await settleReasonOf('conv-back')).toBeNull();

    expect(await sweepIdleConversations(fakeIo({ now: () => unsettledAt + 3 * DAY }).deps)).toEqual(['conv-back']);
    expect(await settleReasonOf('conv-back')).toBe('idle');
  });

  it('skips a root snoozed into the future or whose snooze ended less than N days ago', async () => {
    const { sweepIdleConversations } = await import('../conversation-idle-settle.js');
    await createOld('conv-snoozed', 10 * DAY);
    await createOld('conv-woke', 10 * DAY);
    await createOld('conv-woke-long-ago', 10 * DAY);
    await setColumn('conv-snoozed', 'snoozed_until', NOW + HOUR);
    await setColumn('conv-woke', 'snoozed_until', NOW - DAY);
    await setColumn('conv-woke-long-ago', 'snoozed_until', NOW - 3 * DAY);

    expect(await sweepIdleConversations(fakeIo().deps)).toEqual(['conv-woke-long-ago']);
    expect(await settleReasonOf('conv-snoozed')).toBeNull();
    expect(await settleReasonOf('conv-woke')).toBeNull();
  });

  it('skips a group whose member is waiting on the operator', async () => {
    const { sweepIdleConversations } = await import('../conversation-idle-settle.js');
    await createOld('conv-root', 10 * DAY);
    await createOld('conv-child', 10 * DAY, 'conv-root');
    const io = fakeIo();
    io.waiting.add('conv-child');

    expect(await sweepIdleConversations(io.deps)).toEqual([]);
    expect(await settleReasonOf('conv-root')).toBeNull();
  });

  it('skips a group whose child was active an hour ago and never writes the child', async () => {
    const { sweepIdleConversations } = await import('../conversation-idle-settle.js');
    const { getConversationTriage } = await import('../conversation-triage-store.js');
    await createOld('conv-busy-root', 10 * DAY);
    await createOld('conv-busy-child', 10 * DAY, 'conv-busy-root');
    const io = fakeIo();
    io.activity.set('conv-busy-child', NOW - HOUR);

    expect(await sweepIdleConversations(io.deps)).toEqual([]);
    expect(getConversationTriage('conv-busy-root')?.settledAt).toBeNull();
    expect(getConversationTriage('conv-busy-child')?.settledAt).toBeNull();
  });

  it('settles only the root of an idle group', async () => {
    const { sweepIdleConversations } = await import('../conversation-idle-settle.js');
    await createOld('conv-idle-root', 10 * DAY);
    await createOld('conv-idle-child', 10 * DAY, 'conv-idle-root');

    expect(await sweepIdleConversations(fakeIo().deps)).toEqual(['conv-idle-root']);
    expect(await settleReasonOf('conv-idle-child')).toBeNull();
  });

  it('skips a released root and an agent conversation', async () => {
    const { sweepIdleConversations } = await import('../conversation-idle-settle.js');
    await createOld('conv-released', 10 * DAY);
    await setColumn('conv-released', 'released_to', 'env-x');
    await createOld('agent-pan-1', 10 * DAY);

    expect(await sweepIdleConversations(fakeIo().deps)).toEqual([]);
    expect(await settleReasonOf('conv-released')).toBeNull();
    expect(await settleReasonOf('agent-pan-1')).toBeNull();
  });

  it('skips a group with a fork in progress', async () => {
    const { sweepIdleConversations } = await import('../conversation-idle-settle.js');
    await createOld('conv-forking', 10 * DAY);
    await setColumn('conv-forking', 'fork_status', 'pending');

    expect(await sweepIdleConversations(fakeIo().deps)).toEqual([]);
  });

  it('settles nothing when liveness is unknown', async () => {
    const { sweepIdleConversations } = await import('../conversation-idle-settle.js');
    await createOld('conv-unknown-live', 10 * DAY);
    const settle = vi.fn(() => true);
    const log = vi.fn();
    const io = fakeIo({ listLiveSessions: async () => null, settle, log });

    expect(await sweepIdleConversations(io.deps)).toEqual([]);
    expect(settle).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[idle-settle] terminal sessions could not be listed; skipping this sweep');
  });

  it('settles nothing when the pending-input feed failed', async () => {
    const { sweepIdleConversations } = await import('../conversation-idle-settle.js');
    await createOld('conv-unknown-feed', 10 * DAY);
    const settle = vi.fn(() => true);
    const log = vi.fn();
    const io = fakeIo({ listWaitingNames: async () => null, settle, log });

    expect(await sweepIdleConversations(io.deps)).toEqual([]);
    expect(settle).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[idle-settle] pending-input feed failed; skipping this sweep');
  });

  it('skips a live member with no transcript and settles an ended one', async () => {
    const { sweepIdleConversations } = await import('../conversation-idle-settle.js');
    await createOld('conv-live-blind', 10 * DAY);
    await createOld('conv-ended-blind', 10 * DAY);
    const io = fakeIo();
    io.noTranscript.add('conv-live-blind');
    io.noTranscript.add('conv-ended-blind');
    io.live.add('conv-live-blind');

    expect(await sweepIdleConversations(io.deps)).toEqual(['conv-ended-blind']);
    expect(await settleReasonOf('conv-live-blind')).toBeNull();
  });
});

describe('groupByDisplayRoot', () => {
  it('nests critics under their builder and lanes under their parent, root first', async () => {
    const { groupByDisplayRoot } = await import('../conversation-idle-settle.js');
    const groups = groupByDisplayRoot([
      { id: 3, parentConversationId: 1, criticOfConversationId: 2 },
      { id: 2, parentConversationId: 1, criticOfConversationId: null },
      { id: 1, parentConversationId: null, criticOfConversationId: null },
      { id: 4, parentConversationId: 99, criticOfConversationId: null },
    ]);
    expect([...groups.keys()].sort()).toEqual([1, 4]);
    expect(groups.get(1)!.map((row) => row.id)).toEqual([1, 3, 2]);
    expect(groups.get(4)!.map((row) => row.id)).toEqual([4]);
  });

  it('makes each row of a cycle its own root', async () => {
    const { groupByDisplayRoot } = await import('../conversation-idle-settle.js');
    const groups = groupByDisplayRoot([
      { id: 1, parentConversationId: 2, criticOfConversationId: null },
      { id: 2, parentConversationId: 1, criticOfConversationId: null },
    ]);
    expect([...groups.keys()].sort()).toEqual([1, 2]);
  });
});

describe('readTranscriptLastActivityMs', () => {
  const cutoff = NOW - 3 * DAY;

  function writeTranscript(name: string, records: Array<{ type: string; timestamp: string }>, mtimeMs: number): string {
    const path = join(testHome, name);
    writeFileSync(path, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
    utimesSync(path, mtimeMs / 1000, mtimeMs / 1000);
    return path;
  }

  it('returns the modified time when it is older than the cutoff', async () => {
    const { readTranscriptLastActivityMs } = await import('../conversation-idle-settle.js');
    const mtime = NOW - 5 * DAY;
    const path = writeTranscript('old.jsonl', [{ type: 'assistant', timestamp: new Date(NOW - 6 * DAY).toISOString() }], mtime);
    expect(await readTranscriptLastActivityMs(path, cutoff)).toBe(mtime);
  });

  it('returns the last turn record time when the modified time is recent', async () => {
    const { readTranscriptLastActivityMs } = await import('../conversation-idle-settle.js');
    const recordAt = NOW - 4 * DAY;
    const path = writeTranscript(
      'touched.jsonl',
      [
        { type: 'user', timestamp: new Date(NOW - 5 * DAY).toISOString() },
        { type: 'assistant', timestamp: new Date(recordAt).toISOString() },
        { type: 'system', timestamp: new Date(NOW - HOUR).toISOString() },
      ],
      NOW - HOUR,
    );
    expect(await readTranscriptLastActivityMs(path, cutoff)).toBe(recordAt);
  });

  it('falls back to the modified time when no turn record parses', async () => {
    const { readTranscriptLastActivityMs } = await import('../conversation-idle-settle.js');
    const mtime = NOW - HOUR;
    const path = writeTranscript('no-turns.jsonl', [{ type: 'system', timestamp: new Date(NOW - 5 * DAY).toISOString() }], mtime);
    expect(await readTranscriptLastActivityMs(path, cutoff)).toBe(mtime);
  });

  it('returns null for a missing file', async () => {
    const { readTranscriptLastActivityMs } = await import('../conversation-idle-settle.js');
    expect(await readTranscriptLastActivityMs(join(testHome, 'missing.jsonl'), cutoff)).toBeNull();
  });
});
