/**
 * PAN-3920 W10 / AC-10: `worker` is a first-class Role literal.
 *
 * A registered worker (`pan worker run`) is a native agent with its own
 * state.json. Every exhaustive role list has to accept the literal, and the
 * AgentsResolver decode must not throw on it (PAN-1979: a literal the decoder
 * does not know crashes the whole agent listing).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { afterAll, describe, expect, it, vi } from 'vitest';

// paths.ts resolves the agents dir at module load, so the home has to be
// pointed at a scratch directory before the subject's imports are evaluated.
const testHome = vi.hoisted(() => {
  const { mkdtempSync: makeTemp } = require('node:fs') as typeof import('node:fs');
  const { tmpdir: temp } = require('node:os') as typeof import('node:os');
  const { join: joinPath } = require('node:path') as typeof import('node:path');
  const home = makeTemp(joinPath(temp(), 'role-worker-'));
  process.env.OVERDECK_HOME = home;
  return home;
});

import { isRole } from '../role.js';
import { resolveModel, DEFAULT_ROLES, DEFAULT_WORKHORSES } from '../../config-yaml/roles.js';
import { getAgentStateSync } from '../agent-state-read.js';
import { Db, Tmux } from '../../overdeck/infra.js';
import { AgentsResolver, AgentsResolverLive } from '../../overdeck/agents.js';

function seedWorker(id: string): void {
  const dir = join(testHome, 'agents', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    id,
    issueId: 'PAN-9',
    role: 'worker',
    status: 'running',
    workspace: '/workspaces/feature-pan-9/.swarm/worker-1',
    harness: 'claude-code',
    model: 'claude-sonnet-5',
    startedAt: '2026-09-23T00:00:00.000Z',
    startedBy: 'pan-worker',
    parentId: 'conv-orchestrator',
  }));
}

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
});

describe('role worker (PAN-3920 W10)', () => {
  it('is a Role', () => {
    expect(isRole('worker')).toBe(true);
    expect(isRole('workers')).toBe(false);
  });

  it('routes to the same model as work by default', () => {
    // No workhorses configured: both fail loudly on the same slot; there is no hardcoded fallback.
    expect(() => resolveModel('worker', undefined, {})).toThrow('references workhorse:mid');
    expect(() => resolveModel('work', undefined, {})).toThrow('references workhorse:mid');
    const config = { roles: DEFAULT_ROLES, workhorses: DEFAULT_WORKHORSES };
    expect(resolveModel('worker', undefined, config)).toBe(resolveModel('work', undefined, config));
  });

  it('reads back a worker state.json', () => {
    seedWorker('agent-pan-9-worker-1');
    expect(getAgentStateSync('agent-pan-9-worker-1')).toMatchObject({
      role: 'worker',
      issueId: 'PAN-9',
      parentId: 'conv-orchestrator',
    });
  });

  it('decodes a worker in the AgentsResolver without throwing (PAN-1979)', async () => {
    seedWorker('agent-pan-9-worker-2');
    const db = Layer.succeed(Db, Db.of({
      q: { select: () => ({ from: () => ({ then: (resolve: (rows: unknown[]) => void) => resolve([]) }) }) } as never,
      path: ':memory:',
    }));
    const tmux = Layer.succeed(Tmux, Tmux.of({
      sessionExists: () => Effect.succeed(false),
      killSession: () => Effect.void,
      readRuntimeJson: () => Effect.succeed(null),
      listSessions: () => Effect.succeed([]),
    }));
    const agents = await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* AgentsResolver;
        return yield* resolver.list({ role: 'worker' });
      }).pipe(Effect.provide(AgentsResolverLive.pipe(Layer.provide(db), Layer.provide(tmux)))) as Effect.Effect<
        ReadonlyArray<{ id: string; role: string }>,
        never
      >,
    );
    expect(agents.map((agent) => agent.id)).toContain('agent-pan-9-worker-2');
    expect(agents.every((agent) => agent.role === 'worker')).toBe(true);
  });
});
