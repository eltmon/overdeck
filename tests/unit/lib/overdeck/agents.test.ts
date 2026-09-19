/**
 * Agents domain — the read door.
 *
 * PAN-3917: the overdeck.db `agents` mirror is dropped on every boot, so
 * AgentsResolver reads `~/.overdeck/agents/<id>/state.json`, which is now the
 * only copy of an agent's state. AgentWriter and AgentsApi wrote that mirror
 * and are deleted with it; health events keep their own live table.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Effect, Layer } from 'effect';

// paths.ts resolves AGENTS_DIR once at module load, so the home has to be
// pointed at a scratch directory before the subject's imports are evaluated.
const testHome = vi.hoisted(() => {
  const { mkdtempSync: makeTemp } = require('node:fs') as typeof import('node:fs');
  const { tmpdir: temp } = require('node:os') as typeof import('node:os');
  const { join: joinPath } = require('node:path') as typeof import('node:path');
  const home = makeTemp(joinPath(temp(), 'agents-resolver-'));
  process.env.OVERDECK_HOME = home;
  return home;
});

import { Db, Tmux } from '../../../../src/lib/overdeck/infra.js';
import {
  AgentsResolver, AgentsResolverLive,
  AgentNotFound,
  type AgentId,
} from '../../../../src/lib/overdeck/agents.js';

// ── Fake Db (health_events only — agents no longer has a table) ───────────────

type HealthRow = {
  id: number; agentId: string | null; timestamp: Date; state: string;
  source: string | null; metadata: unknown;
};

const makeQueryResult = (data: unknown[]) => {
  const result: unknown = {
    then: (resolve: (v: unknown[]) => void) => { resolve(data); return result; },
    orderBy: (..._: unknown[]) => makeQueryResult(data),
    where: (_cond: unknown) => makeQueryResult(data),
  };
  return result;
};

function makeDbLayer(healthRows: HealthRow[]): Layer.Layer<Db> {
  const q = {
    select: () => ({ from: () => makeQueryResult(healthRows) }),
  };
  return Layer.succeed(Db, Db.of({ q: q as never, path: ':memory:' }));
}

function makeTmuxLayer(opts?: { sessionAlive?: boolean; runtimeJson?: unknown }) {
  return Layer.succeed(
    Tmux,
    Tmux.of({
      sessionExists: (_name) => Effect.succeed(opts?.sessionAlive ?? false),
      killSession: (_name) => Effect.void,
      readRuntimeJson: (_id) => Effect.succeed(opts?.runtimeJson ?? null),
      listSessions: () => Effect.succeed([]),
    }),
  );
}

describe('AgentsResolver reads agent state files (PAN-3917)', () => {
  beforeEach(() => {
    rmSync(join(testHome, 'agents'), { recursive: true, force: true });
    mkdirSync(join(testHome, 'agents'), { recursive: true });
  });

  afterEach(() => {
    rmSync(join(testHome, 'agents'), { recursive: true, force: true });
  });

  function seed(id: string, overrides: Record<string, unknown> = {}): void {
    const dir = join(testHome, 'agents', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify({
      id,
      issueId: 'PAN-123',
      role: 'work',
      status: 'running',
      workspace: '/workspaces/feature-pan-123',
      harness: 'claude-code',
      model: 'claude-sonnet-4-6',
      sessionId: `sess-${id}`,
      startedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }));
  }

  function run<A, E>(
    effect: (r: AgentsResolver['Service']) => Effect.Effect<A, E>,
    layers: { health?: HealthRow[]; tmux?: { sessionAlive?: boolean; runtimeJson?: unknown } } = {},
  ): Promise<A> {
    const live = AgentsResolverLive.pipe(
      Layer.provide(makeDbLayer(layers.health ?? [])),
      Layer.provide(makeTmuxLayer(layers.tmux)),
    );
    return Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* AgentsResolver;
        return yield* effect(resolver);
      }).pipe(Effect.provide(live)) as Effect.Effect<A, never>,
    );
  }

  it('list({}) maps every state file to an Agent entity', async () => {
    seed('agent-pan-123');
    seed('agent-pan-123-review', { role: 'review', status: 'stopped' });

    const agents = await run((r) => r.list({}));

    expect(agents.map((a) => a.id).sort()).toEqual(['agent-pan-123', 'agent-pan-123-review']);
    expect(agents.find((a) => a.id === 'agent-pan-123')).toMatchObject({
      issueId: 'PAN-123',
      role: 'work',
      status: 'running',
      model: 'claude-sonnet-4-6',
      sessionId: 'sess-agent-pan-123',
    });
  });

  it('list(filter) narrows by issueId, role and status', async () => {
    seed('agent-pan-123');
    seed('agent-pan-123-review', { role: 'review', status: 'stopped' });
    seed('agent-pan-999', { issueId: 'PAN-999' });

    expect((await run((r) => r.list({ role: 'review' }))).map((a) => a.id)).toEqual(['agent-pan-123-review']);
    expect((await run((r) => r.list({ status: 'stopped' }))).map((a) => a.id)).toEqual(['agent-pan-123-review']);
    expect((await run((r) => r.list({ issueId: 'PAN-999' as never }))).map((a) => a.id)).toEqual(['agent-pan-999']);
  });

  it('get(id) returns the matching agent', async () => {
    seed('agent-pan-123');

    const agent = await run((r) => r.get('agent-pan-123' as AgentId));

    expect(agent.id).toBe('agent-pan-123');
    expect(agent.startedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('get(id) fails with AgentNotFound when no state file exists', async () => {
    const outcome = await run((r) => r.get('agent-missing' as AgentId).pipe(
      Effect.map(() => 'resolved'),
      Effect.catchTag('AgentNotFound', (err) => Effect.succeed(`not-found:${err.id}`)),
    ));
    expect(outcome).toBe('not-found:agent-missing');
  });

  it('a state file the entity schema cannot decode is skipped, not fatal', async () => {
    seed('agent-pan-123');
    // A role main does not know yet — a feature branch may invent one. `list`
    // is boot-critical, so it skips the row rather than bricking the dashboard.
    seed('agent-pan-777-oracle', { role: 'oracle' });

    const agents = await run((r) => r.list({}));

    expect(agents.map((a) => a.id)).toEqual(['agent-pan-123']);
  });

  it('a persisted error or waiting status still decodes', async () => {
    seed('agent-pan-123', { status: 'error' });

    expect((await run((r) => r.list({})))[0]?.status).toBe('error');
  });

  it('isAlive delegates to tmux.sessionExists', async () => {
    seed('agent-pan-123');

    expect(await run((r) => r.isAlive('agent-pan-123' as AgentId), { tmux: { sessionAlive: true } })).toBe(true);
    expect(await run((r) => r.isAlive('agent-pan-123' as AgentId), { tmux: { sessionAlive: false } })).toBe(false);
  });

  it('getRuntime resolves the agent first, then reads the tmux runtime json', async () => {
    seed('agent-pan-123');

    const runtime = await run(
      (r) => r.getRuntime('agent-pan-123' as AgentId),
      { tmux: { runtimeJson: { pid: 42 } } },
    );

    expect(runtime).toEqual({ pid: 42 });
  });

  it('getHealthHistory still reads the live health_events table', async () => {
    seed('agent-pan-123');
    const events = await run((r) => r.getHealthHistory('agent-pan-123' as AgentId), {
      health: [{
        id: 1,
        agentId: 'agent-pan-123',
        timestamp: new Date('2026-01-01T01:00:00Z'),
        state: 'running',
        source: 'supervisor',
        metadata: null,
      }],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agentId: 'agent-pan-123', state: 'running' });
  });
});

describe('the write door is gone with the mirror it wrote', () => {
  it('agents.ts exports no AgentWriter, AgentsApi or table-backed sync helper', async () => {
    const mod = await import('../../../../src/lib/overdeck/agents.js') as Record<string, unknown>;
    for (const gone of [
      'AgentWriter', 'AgentWriterLive', 'AgentsApi', 'AgentsDomainLayer',
      'backfillAgentsSync', 'listAllAgentsSync', 'removeAgentRecordSync',
      'tombstoneAgentRecordSync', 'ensureAgentTombstoneSync',
    ]) {
      expect(mod[gone], `${gone} must not survive the cut`).toBeUndefined();
    }
    expect(typeof mod['AgentsResolverLive']).toBe('object');
    expect(AgentNotFound).toBeDefined();
  });
});
