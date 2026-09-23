import { describe, expect, it, vi } from 'vitest';
import {
  companionGeneration,
  companionSessionName,
  createCompanionTerminalLifecycle,
  type CompanionOwner,
  type CompanionTargetResolution,
  type CompanionTerminalAdapter,
} from '../lifecycle.js';
import type { CompanionCreateSpec, CompanionTerminalHost } from '../host.js';

const OWNER: CompanionOwner = {
  conversationName: '20260923-0001',
  ownerSession: 'conv-20260923-0001',
  cwd: '/work/repo',
  harness: 'opencode',
};
const COMPANION = 'companion-conv-20260923-0001';

/** In-memory terminal host: a map of session name → generation stamp. */
function fakeHost(ownerStamp: string | null = '1790000000') {
  const sessions = new Map<string, string | null>();
  const state = { ownerStamp };
  const created: Array<{ name: string; spec: CompanionCreateSpec }> = [];
  const killed: string[] = [];
  const host: CompanionTerminalHost = {
    ownerStamp: vi.fn(async () => state.ownerStamp),
    readGeneration: vi.fn(async (name: string) => (sessions.has(name) ? sessions.get(name) ?? null : undefined)),
    create: vi.fn(async (name: string, spec: CompanionCreateSpec) => {
      // Yield so concurrent opens genuinely interleave around the await.
      await Promise.resolve();
      if (sessions.has(name)) throw new Error(`duplicate session: ${name}`);
      sessions.set(name, spec.generation);
      created.push({ name, spec });
    }),
    kill: vi.fn(async (name: string) => {
      const had = sessions.delete(name);
      if (had) killed.push(name);
      return had;
    }),
  };
  return { host, sessions, state, created, killed };
}

function adapterReturning(...results: CompanionTargetResolution[]): CompanionTerminalAdapter {
  const queue = [...results];
  const last = results[results.length - 1];
  return {
    kind: 'opencode-attach',
    resolveTarget: vi.fn(async () => queue.shift() ?? last),
  };
}

const TARGET: CompanionTargetResolution = {
  ok: true,
  argv: ['/usr/bin/opencode', 'attach', 'http://127.0.0.1:41000', '--session', 'ses_abc', '--dir', '/work/repo'],
  cwd: '/work/repo',
  fingerprint: '41000:ses_abc',
};

function lifecycleWith(host: CompanionTerminalHost, adapter: CompanionTerminalAdapter) {
  return createCompanionTerminalLifecycle({ host, adapters: { 'opencode-attach': adapter }, log: () => undefined });
}

describe('companion terminal lifecycle', () => {
  it('names the companion after the owner and derives a stable generation', () => {
    expect(companionSessionName(OWNER.ownerSession)).toBe(COMPANION);
    expect(() => companionSessionName('conv-bad name')).toThrow(/Invalid tmux session name/);
    const a = companionGeneration(OWNER.ownerSession, '1', '41000:ses_abc');
    expect(a).toMatch(/^[a-f0-9]{24}$/);
    expect(companionGeneration(OWNER.ownerSession, '1', '41000:ses_abc')).toBe(a);
    expect(companionGeneration(OWNER.ownerSession, '2', '41000:ses_abc')).not.toBe(a);
    expect(companionGeneration(OWNER.ownerSession, '1', '41001:ses_abc')).not.toBe(a);
  });

  it('opens a companion with the adapter argv, cwd, and generation stamp', async () => {
    const { host, created } = fakeHost();
    const lifecycle = lifecycleWith(host, adapterReturning(TARGET));

    const state = await lifecycle.open(OWNER);

    expect(state).toEqual({
      status: 'attached',
      kind: 'opencode-attach',
      sessionName: COMPANION,
      generation: companionGeneration(OWNER.ownerSession, '1790000000', '41000:ses_abc'),
      reused: false,
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual({
      name: COMPANION,
      spec: { cwd: '/work/repo', argv: TARGET.ok ? TARGET.argv : [], generation: (state as { generation: string }).generation },
    });
  });

  it('reuses the companion on reopen instead of creating another', async () => {
    const { host, created } = fakeHost();
    const lifecycle = lifecycleWith(host, adapterReturning(TARGET));

    const first = await lifecycle.open(OWNER);
    const second = await lifecycle.open(OWNER);

    expect(created).toHaveLength(1);
    expect(second).toEqual({ ...first, reused: true });
  });

  it('creates exactly one companion for concurrent opens', async () => {
    const { host, created } = fakeHost();
    const lifecycle = lifecycleWith(host, adapterReturning(TARGET));

    const results = await Promise.all([lifecycle.open(OWNER), lifecycle.open(OWNER), lifecycle.open(OWNER)]);

    expect(created).toHaveLength(1);
    expect(results.map((r) => r.status)).toEqual(['attached', 'attached', 'attached']);
    expect(results.filter((r) => r.status === 'attached' && !r.reused)).toHaveLength(1);
  });

  it('replaces a companion stamped for an earlier owner generation', async () => {
    const { host, sessions, created, killed } = fakeHost();
    sessions.set(COMPANION, 'aaaaaaaaaaaaaaaaaaaaaaaa');
    const lifecycle = lifecycleWith(host, adapterReturning(TARGET));

    const state = await lifecycle.open(OWNER);

    expect(killed).toEqual([COMPANION]);
    expect(created).toHaveLength(1);
    expect(state).toMatchObject({ status: 'attached', reused: false });
  });

  it('replaces an unstamped session squatting on the companion name', async () => {
    const { host, sessions, killed } = fakeHost();
    sessions.set(COMPANION, null);
    const lifecycle = lifecycleWith(host, adapterReturning(TARGET));

    await lifecycle.open(OWNER);

    expect(killed).toEqual([COMPANION]);
  });

  it('kills what it created when the owner restarts mid-open (stale generation cannot attach)', async () => {
    const { host, sessions, state: hostState } = fakeHost();
    const restarted: CompanionTargetResolution = { ...TARGET, fingerprint: '42000:ses_abc' } as CompanionTargetResolution;
    const adapter = adapterReturning(TARGET, restarted);
    vi.mocked(host.create).mockImplementation(async (name, spec) => {
      sessions.set(name, spec.generation);
      hostState.ownerStamp = '1790000999';
    });
    const lifecycle = lifecycleWith(host, adapter);

    const state = await lifecycle.open(OWNER);

    expect(state).toMatchObject({ status: 'unavailable', reason: 'owner-changed' });
    expect(sessions.has(COMPANION)).toBe(false);
  });

  it('does not kill a newer companion when the stale open finds it replaced', async () => {
    const { host, sessions } = fakeHost();
    const adapter = adapterReturning(TARGET, { ...TARGET, fingerprint: '42000:ses_abc' } as CompanionTargetResolution);
    vi.mocked(host.create).mockImplementation(async (name) => {
      // Something else already put a newer generation's companion in place.
      sessions.set(name, 'bbbbbbbbbbbbbbbbbbbbbbbb');
    });
    const lifecycle = lifecycleWith(host, adapter);

    const state = await lifecycle.open(OWNER);

    expect(state).toMatchObject({ status: 'unavailable', reason: 'owner-changed' });
    expect(sessions.get(COMPANION)).toBe('bbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('passes adapter unavailability through without creating anything', async () => {
    const { host, created } = fakeHost();
    const lifecycle = lifecycleWith(host, adapterReturning({ ok: false, reason: 'restart-required', message: 'restart it' }));

    const state = await lifecycle.open(OWNER);

    expect(state).toEqual({ status: 'unavailable', kind: 'opencode-attach', reason: 'restart-required', message: 'restart it' });
    expect(created).toHaveLength(0);
  });

  it('leaves a live companion alone while the owner server is briefly unreachable', async () => {
    const { host, sessions, killed } = fakeHost();
    sessions.set(COMPANION, 'cccccccccccccccccccccccc');
    const lifecycle = lifecycleWith(host, adapterReturning({ ok: false, reason: 'owner-starting', message: 'wait' }));

    await lifecycle.open(OWNER);

    expect(killed).toEqual([]);
  });

  it('reaps an orphaned companion and never asks the adapter when the owner session is gone', async () => {
    const { host, sessions, killed } = fakeHost(null);
    sessions.set(COMPANION, 'cccccccccccccccccccccccc');
    const adapter = adapterReturning(TARGET);
    const lifecycle = lifecycleWith(host, adapter);

    const state = await lifecycle.open(OWNER);

    expect(state).toMatchObject({ status: 'unavailable', reason: 'owner-not-running' });
    expect(killed).toEqual([COMPANION]);
    expect(adapter.resolveTarget).not.toHaveBeenCalled();
  });

  it('reports unsupported harnesses without touching the host', async () => {
    const { host } = fakeHost();
    const lifecycle = lifecycleWith(host, adapterReturning(TARGET));

    const state = await lifecycle.open({ ...OWNER, harness: 'codex' });

    expect(state).toMatchObject({ status: 'unavailable', kind: null, reason: 'unsupported' });
    expect(host.ownerStamp).not.toHaveBeenCalled();
    expect(host.create).not.toHaveBeenCalled();
  });

  it('Close kills only the companion for the matching generation', async () => {
    const { host, killed } = fakeHost();
    const lifecycle = lifecycleWith(host, adapterReturning(TARGET));
    const opened = await lifecycle.open(OWNER);
    if (opened.status !== 'attached') throw new Error('expected attached');

    const closed = await lifecycle.close(OWNER, opened.generation);

    expect(closed).toEqual({ status: 'closed', kind: 'opencode-attach' });
    expect(killed).toEqual([COMPANION]);
    expect(host.kill).toHaveBeenCalledTimes(1);
    expect(host.kill).not.toHaveBeenCalledWith(OWNER.ownerSession);
  });

  it('Close with a stale generation refuses and kills nothing', async () => {
    const { host, sessions, killed } = fakeHost();
    sessions.set(COMPANION, 'dddddddddddddddddddddddd');
    const lifecycle = lifecycleWith(host, adapterReturning(TARGET));

    const closed = await lifecycle.close(OWNER, 'eeeeeeeeeeeeeeeeeeeeeeee');

    expect(closed).toMatchObject({ status: 'stale-generation' });
    expect(killed).toEqual([]);
    expect(sessions.get(COMPANION)).toBe('dddddddddddddddddddddddd');
  });

  it('Close is idempotent when no companion exists', async () => {
    const { host } = fakeHost();
    const lifecycle = lifecycleWith(host, adapterReturning(TARGET));

    expect(await lifecycle.close(OWNER, 'eeeeeeeeeeeeeeeeeeeeeeee')).toEqual({ status: 'closed', kind: 'opencode-attach' });
    expect(host.kill).not.toHaveBeenCalled();
  });

  it('owner teardown kills the companion after an in-flight open settles', async () => {
    const { host, sessions } = fakeHost();
    const lifecycle = lifecycleWith(host, adapterReturning(TARGET));

    const [opened, tornDown] = await Promise.all([lifecycle.open(OWNER), lifecycle.closeForOwner(OWNER.ownerSession)]);

    expect(opened).toMatchObject({ status: 'attached' });
    expect(tornDown).toBe(true);
    expect(sessions.has(COMPANION)).toBe(false);
  });

  it('owner teardown never throws', async () => {
    const { host } = fakeHost();
    vi.mocked(host.kill).mockRejectedValue(new Error('tmux down'));
    const lifecycle = lifecycleWith(host, adapterReturning(TARGET));

    await expect(lifecycle.closeForOwner(OWNER.ownerSession)).resolves.toBe(false);
  });

  it('a failed open does not wedge later operations on the same owner', async () => {
    const { host, created } = fakeHost();
    vi.mocked(host.create).mockRejectedValueOnce(new Error('tmux refused'));
    const lifecycle = lifecycleWith(host, adapterReturning(TARGET));

    await expect(lifecycle.open(OWNER)).rejects.toThrow('tmux refused');
    await expect(lifecycle.open(OWNER)).resolves.toMatchObject({ status: 'attached' });
    expect(created).toHaveLength(1);
  });
});
