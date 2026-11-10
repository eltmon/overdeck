import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPushHistory,
  PUSH_HISTORY_FILE,
  pushEntryState,
  type PushHistoryEntry,
  type PushStateContext,
} from '../../../../src/lib/push/push-history.js';
import type { PushSentRecord } from '../../../../src/lib/push/types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'push-history-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sentRecord(overrides: Partial<PushSentRecord> = {}): PushSentRecord {
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2)}`,
    ts: '2026-11-10T12:00:00.000Z',
    kind: 'question',
    category: 'question',
    key: 'auq:t1',
    subject: 'conv:my-conv',
    title: 'my-conv needs you',
    issueId: 'PAN-5111',
    url: '/m?subject=my-conv',
    deliveries: [{ provider: 'webpush', target: 'sub-1', ok: true }],
    ...overrides,
  };
}

async function fileLines(path: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(path, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('push history (PAN-5111)', () => {
  it('appends a sent line with every FR-1 field and no body field', async () => {
    const history = createPushHistory({ dir });
    const record = { ...sentRecord({ id: 'a1' }), body: 'What should I do?', publicTitle: 'Question' } as PushSentRecord;
    history.recordSent(record);
    await history.flush();

    const lines = await fileLines(join(dir, PUSH_HISTORY_FILE));
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line).toMatchObject({ v: 1, type: 'sent', id: 'a1' });
    for (const field of ['id', 'ts', 'kind', 'category', 'key', 'subject', 'title', 'issueId', 'url', 'deliveries']) {
      expect(line).toHaveProperty(field);
    }
    expect(line).not.toHaveProperty('body');
    expect(line).not.toHaveProperty('publicTitle');
    const mode = (await stat(join(dir, PUSH_HISTORY_FILE))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('never writes provider detail text', async () => {
    const history = createPushHistory({ dir });
    const delivery = { provider: 'ntfy', target: 'topic', ok: false, reason: 'rejected', status: 401, detail: 'token=SENTINEL-SECRET' };
    history.recordSent(sentRecord({ id: 'a2', deliveries: [delivery] }));
    await history.flush();

    const text = await readFile(join(dir, PUSH_HISTORY_FILE), 'utf8');
    expect(text).not.toContain('SENTINEL-SECRET');
    const [line] = await fileLines(join(dir, PUSH_HISTORY_FILE));
    expect(line!.deliveries).toEqual([{ provider: 'ntfy', target: 'topic', ok: false, reason: 'rejected', status: 401 }]);
  });

  it('folds a resolved line written before its sent line onto that entry', async () => {
    const sent = { v: 1, type: 'sent', ...sentRecord({ id: 'b1' }) };
    const resolved = { v: 1, type: 'resolved', id: 'b1', ts: '2026-11-10T12:01:00.000Z', outcome: 'answered' };
    await writeFile(join(dir, PUSH_HISTORY_FILE), `${JSON.stringify(resolved)}\nnot json\n${JSON.stringify(sent)}\n`);

    const history = createPushHistory({ dir });
    const entries = await history.recent();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.resolution).toEqual({ outcome: 'answered', ts: '2026-11-10T12:01:00.000Z' });
  });

  it('rotates to .1 past maxBytes and reads both files newest first', async () => {
    const history = createPushHistory({ dir, maxBytes: 600 });
    for (let i = 0; i < 4; i++) history.recordSent(sentRecord({ id: `r${i}` }));
    await history.flush();

    const rotated = await fileLines(join(dir, `${PUSH_HISTORY_FILE}.1`));
    const current = await fileLines(join(dir, PUSH_HISTORY_FILE));
    expect(rotated.length).toBeGreaterThan(0);
    expect(current.length).toBeGreaterThan(0);
    expect((await stat(join(dir, PUSH_HISTORY_FILE))).size).toBeLessThanOrEqual(600);

    const expected = ['r3', 'r2', 'r1', 'r0'].filter((id) => [...rotated, ...current].some((l) => l.id === id));
    expect((await history.recent()).map((e) => e.id)).toEqual(expected);
    const fresh = createPushHistory({ dir, maxBytes: 600 });
    expect((await fresh.recent()).map((e) => e.id)).toEqual(expected);
  });

  it('returns at most the requested number of entries, newest first', async () => {
    const history = createPushHistory({ dir });
    for (let i = 0; i < 5; i++) history.recordSent(sentRecord({ id: `n${i}` }));
    expect((await history.recent(2)).map((e) => e.id)).toEqual(['n4', 'n3']);
  });

  it('openEntryIdFor returns the newest unresolved entry and null after it resolves', async () => {
    const history = createPushHistory({ dir });
    await history.ready();
    history.recordSent(sentRecord({ id: 'o1', key: 'auq:t1', ts: '2026-11-10T12:00:00.000Z' }));
    history.recordSent(sentRecord({ id: 'o2', key: 'auq:t1', ts: '2026-11-10T12:05:00.000Z' }));
    history.recordResolution({ id: 'o1', ts: '2026-11-10T12:01:00.000Z', outcome: 'resolved-without-answer' });

    // auq: keys are global, so any subject matches.
    expect(history.openEntryIdFor('conv:other', 'auq:t1')).toEqual({ id: 'o2', ts: '2026-11-10T12:05:00.000Z' });
    history.recordResolution({ id: 'o2', ts: '2026-11-10T12:06:00.000Z', outcome: 'answered' });
    expect(history.openEntryIdFor('conv:my-conv', 'auq:t1')).toBeNull();
    await history.flush();
    const fresh = createPushHistory({ dir });
    await fresh.ready();
    expect(fresh.openEntryIdFor('conv:my-conv', 'auq:t1')).toBeNull();
  });

  it('openEntryIdFor matches perm: keys only within their subject', async () => {
    const history = createPushHistory({ dir });
    await history.ready();
    history.recordSent(sentRecord({ id: 'p1', key: 'perm:pending', subject: 'agent:a' }));
    expect(history.openEntryIdFor('agent:b', 'perm:pending')).toBeNull();
    expect(history.openEntryIdFor('agent:a', 'perm:pending')).toEqual({ id: 'p1', ts: '2026-11-10T12:00:00.000Z' });
  });
});

describe('pushEntryState (PAN-5111 D-8)', () => {
  const ctx = (over: Partial<PushStateContext> = {}): PushStateContext => ({
    trackedIds: new Set(),
    isPending: () => false,
    warm: false,
    ...over,
  });
  const entry = (over: Partial<PushHistoryEntry> = {}): PushHistoryEntry => ({ ...sentRecord({ id: 'e1' }), resolution: null, ...over });

  it('is null for edge keys', () => {
    expect(pushEntryState(entry({ key: 'journal:x', kind: 'finished' }), ctx({ warm: true }))).toBeNull();
  });

  it('is null when unresolved, untracked, not pending and not warm', () => {
    expect(pushEntryState(entry(), ctx())).toBeNull();
  });

  it('is open when tracked or pending', () => {
    expect(pushEntryState(entry(), ctx({ trackedIds: new Set(['e1']) }))).toBe('open');
    expect(pushEntryState(entry({ key: 'perm:pending' }), ctx({ isPending: (s, k) => s === 'conv:my-conv' && k === 'perm:pending' }))).toBe('open');
  });

  it('returns the stored outcome when resolved', () => {
    const resolution = { outcome: 'answered' as const, ts: '2026-11-10T12:01:00.000Z' };
    expect(pushEntryState(entry({ resolution }), ctx({ trackedIds: new Set(['e1']) }))).toBe('answered');
  });

  it('is resolved-without-answer when warm', () => {
    expect(pushEntryState(entry({ key: 'plan:t2' }), ctx({ warm: true }))).toBe('resolved-without-answer');
  });
});
