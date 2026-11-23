/** PAN-4655 WI-3: the idle-settle sweep decides from an injected clock and fake IO over a real temp database. */
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdleSettleDeps } from '../conversation-idle-settle.js';
import type { LegacyConversation } from '../conversations.js';

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

describe('resurfaceActiveIdleSettles', () => {
  interface FakeResurfaceIo {
    deps: import('../conversation-idle-settle.js').IdleResurfaceDeps;
    activity: Map<string, number>;
    live: Set<string>;
  }

  function fakeResurfaceIo(overrides: Partial<import('../conversation-idle-settle.js').IdleResurfaceDeps> = {}): FakeResurfaceIo {
    const activity = new Map<string, number>();
    const live = new Set<string>();
    const deps: import('../conversation-idle-settle.js').IdleResurfaceDeps = {
      now: () => NOW,
      listLiveSessions: vi.fn(async () => live),
      resolveTranscript: vi.fn(async (conv) => `/transcripts/${conv.name}.jsonl`),
      lastActivityMs: vi.fn(async (path: string) => {
        const name = path.slice('/transcripts/'.length, -'.jsonl'.length);
        return activity.get(name) ?? null;
      }),
      log: () => {},
      ...overrides,
    };
    return { deps, activity, live };
  }

  async function settleIdleAt(name: string, settledAtMs: number): Promise<void> {
    const { settleIdleConversation } = await import('../conversation-triage-store.js');
    settleIdleConversation(name, 0, settledAtMs);
  }

  it('resurfaces an idle root with newer live activity and leaves one with activity at or before settled_at', async () => {
    const { resurfaceActiveIdleSettles } = await import('../conversation-idle-settle.js');
    await createOld('conv-new', 10 * DAY);
    await createOld('conv-same', 10 * DAY);
    await settleIdleAt('conv-new', 1_000);
    await settleIdleAt('conv-same', 1_000);
    const io = fakeResurfaceIo();
    io.live.add('conv-new');
    io.live.add('conv-same');
    io.activity.set('conv-new', 1_001);
    io.activity.set('conv-same', 1_000);

    expect(await resurfaceActiveIdleSettles(io.deps)).toEqual(['conv-new']);
    expect(await settleReasonOf('conv-new')).toBeNull();
    expect(await settleReasonOf('conv-same')).toBe('idle');
  });

  it('leaves manual and merge roots even with newer activity', async () => {
    const { resurfaceActiveIdleSettles } = await import('../conversation-idle-settle.js');
    const { settleConversation } = await import('../conversation-triage-store.js');
    await createOld('conv-manual', 10 * DAY);
    await createOld('conv-merge', 10 * DAY);
    settleConversation('conv-manual', 'manual', 1_000);
    settleConversation('conv-merge', 'merge', 1_000);
    const io = fakeResurfaceIo();
    io.live.add('conv-manual');
    io.live.add('conv-merge');
    io.activity.set('conv-manual', 2_000);
    io.activity.set('conv-merge', 2_000);

    expect(await resurfaceActiveIdleSettles(io.deps)).toEqual([]);
    expect(await settleReasonOf('conv-manual')).toBe('manual');
    expect(await settleReasonOf('conv-merge')).toBe('merge');
  });

  it("resurfaces the root when only a child's transcript is newer", async () => {
    const { resurfaceActiveIdleSettles } = await import('../conversation-idle-settle.js');
    await createOld('conv-child-root', 10 * DAY);
    await createOld('conv-child-kid', 10 * DAY, 'conv-child-root');
    await settleIdleAt('conv-child-root', 1_000);
    const io = fakeResurfaceIo();
    io.live.add('conv-child-kid');
    io.activity.set('conv-child-root', 500);
    io.activity.set('conv-child-kid', 1_500);

    expect(await resurfaceActiveIdleSettles(io.deps)).toEqual(['conv-child-root']);
  });

  it('leaves a group with no live member and never resolves its transcripts', async () => {
    const { resurfaceActiveIdleSettles } = await import('../conversation-idle-settle.js');
    await createOld('conv-no-live', 10 * DAY);
    await settleIdleAt('conv-no-live', 1_000);
    const io = fakeResurfaceIo();
    io.activity.set('conv-no-live', 5_000);

    expect(await resurfaceActiveIdleSettles(io.deps)).toEqual([]);
    expect(io.deps.resolveTranscript).not.toHaveBeenCalled();
  });

  it('resurfaces nothing and logs when listLiveSessions returns null', async () => {
    const { resurfaceActiveIdleSettles } = await import('../conversation-idle-settle.js');
    await createOld('conv-unknown-live', 10 * DAY);
    await settleIdleAt('conv-unknown-live', 1_000);
    const log = vi.fn();
    const io = fakeResurfaceIo({ listLiveSessions: async () => null, log });

    expect(await resurfaceActiveIdleSettles(io.deps)).toEqual([]);
    expect(log).toHaveBeenCalledWith('[idle-settle] terminal sessions could not be listed; skipping resurface');
  });

  it('resurfaces even when auto_settle_idle_days is 0 (no idleDays dependency is read)', async () => {
    const { setConversationsAutoSettleIdleDays } = await import('../control-settings.js');
    const { resurfaceActiveIdleSettles } = await import('../conversation-idle-settle.js');
    setConversationsAutoSettleIdleDays(0);
    await createOld('conv-zero-days', 10 * DAY);
    await settleIdleAt('conv-zero-days', 1_000);
    const io = fakeResurfaceIo();
    io.live.add('conv-zero-days');
    io.activity.set('conv-zero-days', 5_000);

    expect(await resurfaceActiveIdleSettles(io.deps)).toEqual(['conv-zero-days']);
  });

  it('the default door guards on the settledAtMs the pass read, not the current row', async () => {
    const { resurfaceActiveIdleSettles } = await import('../conversation-idle-settle.js');
    const { listIdleClocks } = await import('../conversation-triage-store.js');
    await createOld('conv-guard', 10 * DAY);
    await settleIdleAt('conv-guard', 2_000);
    const realClock = listIdleClocks().get('conv-guard')!;
    const io = fakeResurfaceIo({ listIdleClocks: () => new Map([['conv-guard', { ...realClock, settledAtMs: 1_000 }]]) });
    io.live.add('conv-guard');
    io.activity.set('conv-guard', 5_000);

    expect(await resurfaceActiveIdleSettles(io.deps)).toEqual([]);
    expect(await settleReasonOf('conv-guard')).toBe('idle');
  });

  it('does not return a name when the injected resurface door returns false', async () => {
    const { resurfaceActiveIdleSettles } = await import('../conversation-idle-settle.js');
    await createOld('conv-rejected', 10 * DAY);
    await settleIdleAt('conv-rejected', 1_000);
    const resurface = vi.fn(() => false);
    const io = fakeResurfaceIo({ resurface });
    io.live.add('conv-rejected');
    io.activity.set('conv-rejected', 5_000);

    expect(await resurfaceActiveIdleSettles(io.deps)).toEqual([]);
    expect(resurface).toHaveBeenCalledWith('conv-rejected', 1_000, NOW);
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

describe('displayRootNameOf', () => {
  function conv(overrides: Partial<LegacyConversation> & { id: number; name: string }): LegacyConversation {
    return { parentConversationId: null, criticOfConversationId: null, ...overrides } as LegacyConversation;
  }

  it('returns the parent name for a lane under a parent', async () => {
    const { displayRootNameOf } = await import('../conversation-idle-settle.js');
    const rows = [conv({ id: 1, name: 'root' }), conv({ id: 2, name: 'lane-a', parentConversationId: 1 })];
    expect(displayRootNameOf('lane-a', rows)).toBe('root');
  });

  it('returns the top root name for a successor two levels down', async () => {
    const { displayRootNameOf } = await import('../conversation-idle-settle.js');
    const rows = [
      conv({ id: 1, name: 'root' }),
      conv({ id: 2, name: 'handoff-1', parentConversationId: 1 }),
      conv({ id: 3, name: 'handoff-2', parentConversationId: 2 }),
    ];
    expect(displayRootNameOf('handoff-2', rows)).toBe('root');
  });

  it("returns the builder's root name for a critic", async () => {
    const { displayRootNameOf } = await import('../conversation-idle-settle.js');
    const rows = [
      conv({ id: 1, name: 'builder-root' }),
      conv({ id: 2, name: 'builder', parentConversationId: 1 }),
      conv({ id: 3, name: 'critic', criticOfConversationId: 2 }),
    ];
    expect(displayRootNameOf('critic', rows)).toBe('builder-root');
  });

  it('returns the name unchanged when the parent is not listed or the name is unknown', async () => {
    const { displayRootNameOf } = await import('../conversation-idle-settle.js');
    const rows = [conv({ id: 2, name: 'orphan', parentConversationId: 99 })];
    expect(displayRootNameOf('orphan', rows)).toBe('orphan');
    expect(displayRootNameOf('does-not-exist', rows)).toBe('does-not-exist');
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
