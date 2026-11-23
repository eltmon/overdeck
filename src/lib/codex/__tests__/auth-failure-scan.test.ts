import { describe, expect, it, vi } from 'vitest';

import type { CodexLastTurn } from '../../conversations/codex-thread-status.js';
import { CODEX_AUTH_SCAN_CACHE_MS, createCodexAuthFailureScanner } from '../auth-failure-scan.js';

const AUTH: CodexLastTurn = {
  status: 'done',
  failure: { message: 'refresh token was already used', at: '2026-11-23T17:33:20.000Z', code: 'unauthorized', kind: 'auth' },
};
const CONTEXT: CodexLastTurn = {
  status: 'done',
  failure: { message: 'context full', at: '2026-11-23T17:44:36.000Z', code: 'context_window_exceeded', kind: 'context-window' },
};
const OK: CodexLastTurn = { status: 'done', failure: null };

function scanner(turns: Record<string, CodexLastTurn | Error>, clock = { t: 0 }) {
  const listSessionIds = vi.fn(async () => Object.keys(turns));
  const resolveRollout = vi.fn(async (id: string) => `/rollouts/${id}.jsonl`);
  const readLastTurn = vi.fn(async (path: string) => {
    const turn = turns[path.slice('/rollouts/'.length, -'.jsonl'.length)]!;
    if (turn instanceof Error) throw turn;
    return turn;
  });
  const scan = createCodexAuthFailureScanner({ listSessionIds, resolveRollout, readLastTurn, now: () => clock.t });
  return { scan, listSessionIds, resolveRollout, readLastTurn, clock };
}

describe('createCodexAuthFailureScanner (PAN-5633)', () => {
  it('returns only auth failures', async () => {
    const { scan } = scanner({ 'conv-auth': AUTH, 'conv-context': CONTEXT, 'agent-ok': OK });
    await expect(scan()).resolves.toEqual([
      { id: 'conv-auth', at: '2026-11-23T17:33:20.000Z', message: 'refresh token was already used' },
    ]);
  });

  it('serves a second call within 15 s from the cache', async () => {
    const { scan, listSessionIds, clock } = scanner({ 'conv-auth': AUTH });
    await scan();
    clock.t += CODEX_AUTH_SCAN_CACHE_MS - 1;
    await scan();
    expect(listSessionIds).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight scan between concurrent callers', async () => {
    const { scan, listSessionIds } = scanner({ 'conv-auth': AUTH });
    const [a, b] = await Promise.all([scan(), scan()]);
    expect(a).toBe(b);
    expect(listSessionIds).toHaveBeenCalledTimes(1);
  });

  it('rescans after 15 s', async () => {
    const { scan, listSessionIds, clock } = scanner({ 'conv-auth': AUTH });
    await scan();
    clock.t += 15_001;
    await scan();
    expect(listSessionIds).toHaveBeenCalledTimes(2);
  });

  it('skips a session whose rollout read throws', async () => {
    const { scan } = scanner({ 'conv-broken': new Error('EACCES'), 'conv-auth': AUTH });
    const failures = await scan();
    expect(failures.map((f) => f.id)).toEqual(['conv-auth']);
  });

  it('does not cache a rejected scan', async () => {
    const listSessionIds = vi.fn()
      .mockRejectedValueOnce(new Error('db busy'))
      .mockResolvedValueOnce(['conv-auth']);
    const scan = createCodexAuthFailureScanner({
      listSessionIds,
      resolveRollout: async (id) => `/rollouts/${id}.jsonl`,
      readLastTurn: async () => AUTH,
      now: () => 0,
    });
    await expect(scan()).rejects.toThrow('db busy');
    await expect(scan()).resolves.toHaveLength(1);
  });

  it('caps the scan at 64 sessions', async () => {
    const turns = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`conv-${i}`, OK]));
    const { scan, resolveRollout } = scanner(turns);
    await scan();
    expect(resolveRollout).toHaveBeenCalledTimes(64);
  });
});
