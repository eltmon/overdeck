/**
 * PAN-3849 (W33): POST /api/agents/:id/lifecycle.
 *
 * The route authenticates with the agent's pty-token and applies the event
 * through the one-transaction projection: an `exited` event writes
 * state.json `stopped` and the agents row agrees — the agent's own supervisor
 * reports its exit, no patrol inference (FR-21).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writePtyTokenSync } from '../../../../src/lib/pty-token.js';
import { saveOverdeckAgentStateSync } from '../../../../src/lib/overdeck/agent-state-sync.js';
import { getOverdeckAgentStateSync } from '../../../helpers/overdeck-test-db.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';
import type { AgentState } from '../../../../src/lib/agents.js';

// The projection logs via persistent-logger — fire-and-forget in tests.
vi.mock('../../../../src/lib/persistent-logger.js', () => ({
  logAgentLifecycleSync: vi.fn(),
}));

import { postAgentLifecycleRoute } from '../../../../src/dashboard/server/routes/agents/lifecycle.js';
import { initEventStore } from '../../../../src/dashboard/server/event-store.js';

const AGENT = 'agent-pan-3849';
const TOKEN = 'route-test-token';

let odb: OverdeckTestDb;

function seedAgent(overrides: Partial<AgentState> = {}): AgentState {
  const state = {
    id: AGENT,
    issueId: 'PAN-3849',
    workspace: '/tmp/ws-pan-3849',
    role: 'work',
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: '2026-09-17T10:00:00.000Z',
    ...overrides,
  } as AgentState;
  saveOverdeckAgentStateSync(state);
  return state;
}

async function postLifecycle(body: Record<string, unknown>, token?: string) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/agents/${AGENT}/lifecycle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token !== undefined ? { 'x-overdeck-pty-token': token } : {}),
    },
    body: JSON.stringify(body),
  }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(postAgentLifecycleRoute), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

beforeEach(async () => {
  odb = setupOverdeckTestDb();
  // The projection emits through the shared event store; initialize it once
  // per process against the current home (emit-only for these tests).
  await initEventStore();
}, 20_000);

afterEach(() => {
  teardownOverdeckTestDb(odb);
  vi.clearAllMocks();
});

describe('POST /api/agents/:id/lifecycle (PAN-3849 W33)', () => {
  it('rejects an unauthenticated event with 401', async () => {
    seedAgent();
    writePtyTokenSync(AGENT);

    const res = await postLifecycle({ event: 'exited', at: '2026-09-17T12:00:00.000Z' }, 'wrong-token');
    expect(res.status).toBe(401);

    const noHeader = await postLifecycle({ event: 'exited', at: '2026-09-17T12:00:00.000Z' });
    expect(noHeader.status).toBe(401);

    // State untouched.
    expect(getOverdeckAgentStateSync(AGENT)?.status).toBe('running');
  });

  it('exited → state.json status is stopped and the agents row agrees', async () => {
    seedAgent();
    writePtyTokenSync(AGENT);
    const token = readFileSync(join(odb.home, 'agents', AGENT, 'pty-token'), 'utf8').trim();

    const res = await postLifecycle({ event: 'exited', at: '2026-09-17T12:00:00.000Z', exitCode: 0 }, token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, applied: true, status: 'stopped' });

    // The agents row agrees.
    const row = getOverdeckAgentStateSync(AGENT);
    expect(row?.status).toBe('stopped');
    expect(row?.stoppedAt).toBe('2026-09-17T12:00:00.000Z');

    // state.json agrees (the rollback source the write door owns).
    const stateJson = JSON.parse(
      readFileSync(join(odb.home, 'agents', AGENT, 'state.json'), 'utf8'),
    ) as { status: string; stoppedAt?: string };
    expect(stateJson.status).toBe('stopped');
    expect(stateJson.stoppedAt).toBe('2026-09-17T12:00:00.000Z');
  });

  it('session-started → running, emitted as agent.started only when the process exists', async () => {
    seedAgent({ status: 'starting' });
    writePtyTokenSync(AGENT);
    const token = readFileSync(join(odb.home, 'agents', AGENT, 'pty-token'), 'utf8').trim();

    const res = await postLifecycle({ event: 'session-started', at: '2026-09-17T12:05:00.000Z' }, token);
    expect(res.status).toBe(200);
    expect(getOverdeckAgentStateSync(AGENT)?.status).toBe('running');
    expect(getOverdeckAgentStateSync(AGENT)?.lastActivity).toBe('2026-09-17T12:05:00.000Z');
  });

  it('a late session-started after exited does not resurrect the agent', async () => {
    seedAgent({ status: 'stopped', stoppedAt: '2026-09-17T11:00:00.000Z' });
    writePtyTokenSync(AGENT);
    const token = readFileSync(join(odb.home, 'agents', AGENT, 'pty-token'), 'utf8').trim();

    const res = await postLifecycle({ event: 'session-started', at: '2026-09-17T12:05:00.000Z' }, token);
    expect(res.status).toBe(409);
    expect(getOverdeckAgentStateSync(AGENT)?.status).toBe('stopped');
  });

  it('rejects an unknown event name with 400', async () => {
    seedAgent();
    writePtyTokenSync(AGENT);
    const token = readFileSync(join(odb.home, 'agents', AGENT, 'pty-token'), 'utf8').trim();

    const res = await postLifecycle({ event: 'exploded', at: '2026-09-17T12:00:00.000Z' }, token);
    expect(res.status).toBe(400);
  });

  it('returns 404 when the agent has no state to project', async () => {
    writePtyTokenSync(AGENT);
    const token = readFileSync(join(odb.home, 'agents', AGENT, 'pty-token'), 'utf8').trim();

    const res = await postLifecycle({ event: 'exited', at: '2026-09-17T12:00:00.000Z' }, token);
    expect(res.status).toBe(404);
  });
});
