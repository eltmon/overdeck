/**
 * PAN-3849 (W33): POST /api/agents/:id/lifecycle.
 *
 * The route authenticates with the agent's pty-token and appends the
 * supervisor's own observation as an event — the agent's own supervisor
 * reports its exit, no patrol inference (FR-21).
 *
 * PAN-3917 (W6): the projection writes no status anywhere. An `exited` event
 * appends `agent.stopped`; whether the session is alive is the terminal
 * backend's answer, read live, so there is no mirror row and no state.json
 * status for this route to keep in step.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { writePtyTokenSync } from '../../../../src/lib/pty-token.js';
import { saveOverdeckAgentStateSync } from '../../../helpers/overdeck-test-db.js';
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

// PAN-3917: whether a late session-started may resurrect the agent is the
// TERMINAL BACKEND's answer — the pane's own state — not a stored status.
const backendPanes: Array<{ id: string; terminalId: string; state: string }> = [];
vi.mock('../../../../src/dashboard/server/services/backend-inventory.js', () => ({
  getBackendPanes: async () => backendPanes,
}));

import { postAgentLifecycleRoute } from '../../../../src/dashboard/server/routes/agents/lifecycle.js';
import { _resetAgentLifecycleDedupeForTests } from '../../../../src/dashboard/server/services/agent-projection.js';
import { getEventStore, initEventStore } from '../../../../src/dashboard/server/event-store.js';

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

// The event store is a process singleton holding prepared statements against
// the home it opened, so the home is set up once for the file rather than per
// case — tearing it down between cases finalizes those statements.
beforeAll(async () => {
  odb = setupOverdeckTestDb();
  await initEventStore();
}, 20_000);

afterAll(() => {
  teardownOverdeckTestDb(odb);
});

beforeEach(() => {
  _resetAgentLifecycleDedupeForTests();
  rmSync(join(odb.home, 'agents', AGENT), { recursive: true, force: true });
});

afterEach(() => {
  backendPanes.length = 0;
  vi.clearAllMocks();
});

/** The types appended since this call, so a case can assert what it emitted. */
function eventsSince(sequence: number): string[] {
  return getEventStore().readFrom(sequence).map((stored) => stored.type);
}

function currentSequence(): number {
  const all = getEventStore().readFrom(0);
  return all.length === 0 ? 0 : all[all.length - 1]!.sequence;
}

describe('POST /api/agents/:id/lifecycle (PAN-3849 W33)', () => {
  it('rejects an unauthenticated event with 401', async () => {
    seedAgent();
    writePtyTokenSync(AGENT);

    const res = await postLifecycle({ event: 'exited', at: '2026-09-17T12:00:00.000Z' }, 'wrong-token');
    expect(res.status).toBe(401);

    const noHeader = await postLifecycle({ event: 'exited', at: '2026-09-17T12:00:00.000Z' });
    expect(noHeader.status).toBe(401);
  });

  it('exited → the supervisor\'s exit is appended as agent.stopped', async () => {
    seedAgent();
    writePtyTokenSync(AGENT);
    const token = readFileSync(join(odb.home, 'agents', AGENT, 'pty-token'), 'utf8').trim();
    const before = currentSequence();

    const res = await postLifecycle({ event: 'exited', at: '2026-09-17T12:00:00.000Z', exitCode: 0 }, token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, applied: true, status: 'stopped' });
    expect(eventsSince(before)).toContain('agent.stopped');
  });

  it('session-started → running, emitted as agent.started only when the process exists', async () => {
    seedAgent({ status: 'starting' });
    writePtyTokenSync(AGENT);
    const token = readFileSync(join(odb.home, 'agents', AGENT, 'pty-token'), 'utf8').trim();

    const before = currentSequence();
    const res = await postLifecycle({ event: 'session-started', at: '2026-09-17T12:05:00.000Z' }, token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, applied: true, status: 'running' });
    expect(eventsSince(before)).toContain('agent.started');
  });

  it('a late session-started after the backend reports the pane exited does not resurrect the agent', async () => {
    seedAgent({ status: 'stopped', stoppedAt: '2026-09-17T11:00:00.000Z' });
    backendPanes.push({ id: AGENT, terminalId: AGENT, state: 'exited' });
    writePtyTokenSync(AGENT);
    const token = readFileSync(join(odb.home, 'agents', AGENT, 'pty-token'), 'utf8').trim();

    const before = currentSequence();
    const res = await postLifecycle({ event: 'session-started', at: '2026-09-17T12:05:00.000Z' }, token);
    expect(res.status).toBe(409);
    expect(eventsSince(before)).not.toContain('agent.started');
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
