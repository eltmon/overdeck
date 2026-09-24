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
 *
 * PAN-3962: the same route records a supervised CONVERSATION's lifecycle.
 * Conversations have no agent state.json, so the route used to 404 every
 * `conv-*` event; now it resolves the conversations row by tmux session.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { writePtyToken } from '../../../../src/lib/pty-token.js';
import {
  createConversation,
  getConversationByName,
  markConversationEnded,
  setClearedToConvId,
} from '../../../../src/lib/overdeck/conversations.js';
import { markRespawnPending } from '../../../../src/dashboard/server/services/pending-respawn.js';
import { saveOverdeckAgentStateSync } from '../../../helpers/overdeck-test-db.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';
import type { AgentState } from '../../../../src/lib/agents.js';

// The projection logs via persistent-logger — fire-and-forget in tests.
vi.mock('../../../../src/lib/persistent-logger.js', () => ({
  logAgentLifecycle: vi.fn(),
}));

// PAN-3917: whether a late session-started may resurrect the agent is the
// TERMINAL BACKEND's answer — the pane's own state — not a stored status.
const backendPanes: Array<{ id: string; terminalId: string; state: string }> = [];
vi.mock('../../../../src/dashboard/server/services/backend-inventory.js', () => ({
  getBackendPanes: async () => backendPanes,
}));

// The exit path runs the poller's attachment cleanup; keep it off disk here.
const cleanupAttachments = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../../../src/dashboard/server/services/conversation-attachments.js', () => ({
  cleanupUnreferencedConversationAttachments: cleanupAttachments,
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

async function postLifecycle(body: Record<string, unknown>, token?: string, id: string = AGENT) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/agents/${id}/lifecycle`, {
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

/** The events appended since this call, with payloads, for conversation cases. */
function eventRecordsSince(sequence: number): Array<{ type: string; payload: Record<string, unknown> }> {
  return getEventStore().readFrom(sequence).map((stored) => ({
    type: stored.type,
    payload: (stored as unknown as { payload: Record<string, unknown> }).payload,
  }));
}

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
    await writePtyToken(AGENT);

    const res = await postLifecycle({ event: 'exited', at: '2026-09-17T12:00:00.000Z' }, 'wrong-token');
    expect(res.status).toBe(401);

    const noHeader = await postLifecycle({ event: 'exited', at: '2026-09-17T12:00:00.000Z' });
    expect(noHeader.status).toBe(401);
  });

  it('exited → the supervisor\'s exit is appended as agent.stopped', async () => {
    seedAgent();
    await writePtyToken(AGENT);
    const token = readFileSync(join(odb.home, 'agents', AGENT, 'pty-token'), 'utf8').trim();
    const before = currentSequence();

    const res = await postLifecycle({ event: 'exited', at: '2026-09-17T12:00:00.000Z', exitCode: 0 }, token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, applied: true, status: 'stopped' });
    expect(eventsSince(before)).toContain('agent.stopped');
  });

  it('session-started → running, emitted as agent.started only when the process exists', async () => {
    seedAgent({ status: 'starting' });
    await writePtyToken(AGENT);
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
    await writePtyToken(AGENT);
    const token = readFileSync(join(odb.home, 'agents', AGENT, 'pty-token'), 'utf8').trim();

    const before = currentSequence();
    const res = await postLifecycle({ event: 'session-started', at: '2026-09-17T12:05:00.000Z' }, token);
    expect(res.status).toBe(409);
    expect(eventsSince(before)).not.toContain('agent.started');
  });

  it('rejects an unknown event name with 400', async () => {
    seedAgent();
    await writePtyToken(AGENT);
    const token = readFileSync(join(odb.home, 'agents', AGENT, 'pty-token'), 'utf8').trim();

    const res = await postLifecycle({ event: 'exploded', at: '2026-09-17T12:00:00.000Z' }, token);
    expect(res.status).toBe(400);
  });

  it('returns 404 when the agent has no state to project', async () => {
    await writePtyToken(AGENT);
    const token = readFileSync(join(odb.home, 'agents', AGENT, 'pty-token'), 'utf8').trim();

    const res = await postLifecycle({ event: 'exited', at: '2026-09-17T12:00:00.000Z' }, token);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/agents/:id/lifecycle for a supervised conversation (PAN-3962)', () => {
  let counter = 0;

  /** A fresh conversation row + pty-token; the supervised id is `conv-<name>`. */
  async function seedConversation(): Promise<{ name: string; sessionId: string; token: string }> {
    counter += 1;
    const name = `20260922-l${counter}`;
    const sessionId = `conv-${name}`;
    createConversation({
      name,
      tmuxSession: sessionId,
      cwd: '/tmp/conv-pan-3962',
      harness: 'claude-code',
      workspaceId: null,
    });
    const token = await writePtyToken(sessionId);
    return { name, sessionId, token };
  }

  it('records the full start → turn → exit lifecycle with 2xx on every event', async () => {
    const { name, sessionId, token } = await seedConversation();
    // The conversation was ended by a previous run; the new supervisor revives it.
    markConversationEnded(name, Date.parse('2026-09-22T09:00:00.000Z'));
    expect(getConversationByName(name)?.status).toBe('ended');
    const before = currentSequence();

    const started = await postLifecycle({ event: 'session-started', at: '2026-09-22T10:00:00.000Z' }, token, sessionId);
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ success: true, applied: true, status: 'running' });
    expect(getConversationByName(name)).toMatchObject({ status: 'active', endedAt: null });

    const turn = await postLifecycle({ event: 'turn-started', at: '2026-09-22T10:00:05.000Z' }, token, sessionId);
    expect(turn.status).toBe(200);
    expect(turn.body).toMatchObject({ success: true, applied: true });

    const turnEnded = await postLifecycle({ event: 'turn-ended', at: '2026-09-22T10:00:30.000Z' }, token, sessionId);
    expect(turnEnded.status).toBe(200);

    const exitAt = '2026-09-22T10:01:00.000Z';
    const exited = await postLifecycle({ event: 'exited', at: exitAt, exitCode: 1 }, token, sessionId);
    expect(exited.status).toBe(200);
    expect(exited.body).toMatchObject({ success: true, applied: true, status: 'stopped' });

    expect(cleanupAttachments).toHaveBeenCalledTimes(1);
    expect(cleanupAttachments).toHaveBeenCalledWith({ name, sessionFile: null });

    const row = getConversationByName(name);
    expect(row?.status).toBe('ended');
    expect(row?.endedAt).not.toBeNull();
    expect(new Date(row!.endedAt!).getTime()).toBe(Date.parse(exitAt));

    // Runtime activity is appended under the session id the conversation's
    // hooks already report under; no agent.started/agent.stopped for a
    // conversation (it is not an agent and has no issue id).
    const records = eventRecordsSince(before);
    const activity = records
      .filter((record) => record.type === 'agent.activity_changed' && record.payload['agentId'] === sessionId)
      .map((record) => record.payload['activity']);
    expect(activity).toEqual(['idle', 'working', 'idle', 'stopped']);
    expect(records.map((record) => record.type)).not.toContain('agent.started');
    expect(records.map((record) => record.type)).not.toContain('agent.stopped');
  });

  it('a retried exited POST is a 2xx no-op', async () => {
    const { sessionId, token } = await seedConversation();
    const body = { event: 'exited', at: '2026-09-22T11:00:00.000Z', exitCode: 0 };

    expect((await postLifecycle(body, token, sessionId)).status).toBe(200);
    const retry = await postLifecycle(body, token, sessionId);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ success: true, applied: false, reason: 'duplicate' });
  });

  it('an exit dated before the respawn began is ignored (the replaced harness)', async () => {
    const { name, sessionId, token } = await seedConversation();
    const respawn = markRespawnPending(sessionId);
    try {
      const res = await postLifecycle({ event: 'exited', at: '2026-09-22T12:00:00.000Z', exitCode: 0 }, token, sessionId);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, applied: false, reason: 'respawn-pending' });
      expect(getConversationByName(name)?.status).toBe('active');
    } finally {
      respawn.done();
    }
  });

  it('a late session-started older than the recorded exit does not revive the conversation', async () => {
    const { name, sessionId, token } = await seedConversation();
    // No backend pane is listed for the conv-* session (a Herdr host): the
    // guard must not depend on the pane inventory.
    const exited = await postLifecycle(
      { event: 'exited', at: '2026-09-22T13:00:05.000Z', exitCode: 1 }, token, sessionId,
    );
    expect(exited.status).toBe(200);

    const late = await postLifecycle({ event: 'session-started', at: '2026-09-22T13:00:00.000Z' }, token, sessionId);
    expect(late.status).toBe(409);
    expect(getConversationByName(name)?.status).toBe('ended');
  });

  it('the new harness exiting inside the resume window ends the conversation (review of #3988, F1)', async () => {
    const { name, sessionId, token } = await seedConversation();
    markConversationEnded(name, Date.now() - 60_000);
    const respawn = markRespawnPending(sessionId);
    try {
      const launchedAt = new Date().toISOString();
      const started = await postLifecycle({ event: 'session-started', at: launchedAt, launchedAt }, token, sessionId);
      expect(started.body).toMatchObject({ applied: true, status: 'running' });
      expect(getConversationByName(name)?.status).toBe('active');

      const exitAt = new Date(Date.parse(launchedAt) + 500).toISOString();
      const exited = await postLifecycle({ event: 'exited', at: exitAt, launchedAt, exitCode: 1 }, token, sessionId);
      expect(exited.status).toBe(200);
      expect(exited.body).toMatchObject({ success: true, applied: true, status: 'stopped' });
      expect(getConversationByName(name)?.status).toBe('ended');
    } finally {
      respawn.done();
    }
  });

  it('events for a post-/clear sibling land on the sibling, never the /clear-ended parent (F2)', async () => {
    const { name: parentName, sessionId, token } = await seedConversation();
    const sibling = createConversation({
      name: `${parentName}-post-clear-abcd1234`,
      tmuxSession: sessionId,
      cwd: '/tmp/conv-pan-3962',
      harness: 'claude-code',
      workspaceId: null,
    });
    setClearedToConvId(parentName, sibling.id);
    const parentEndedAt = Date.parse('2026-09-22T15:00:00.000Z');
    markConversationEnded(parentName, parentEndedAt);

    const exitAt = '2026-09-22T15:10:00.000Z';
    const exited = await postLifecycle({ event: 'exited', at: exitAt, exitCode: 0 }, token, sessionId);
    expect(exited.body).toMatchObject({ applied: true, status: 'stopped' });
    expect(new Date(getConversationByName(sibling.name)!.endedAt!).getTime()).toBe(Date.parse(exitAt));
    // The parent keeps its own /clear end time: the exit was not its own.
    expect(new Date(getConversationByName(parentName)!.endedAt!).getTime()).toBe(parentEndedAt);

    // The operator resumes the sibling; its new supervisor starts.
    const started = await postLifecycle({ event: 'session-started', at: '2026-09-22T15:20:00.000Z' }, token, sessionId);
    expect(started.body).toMatchObject({ applied: true, status: 'running' });
    expect(getConversationByName(sibling.name)?.status).toBe('active');
    expect(getConversationByName(parentName)?.status).toBe('ended');
  });

  it('still 404s a conv id with neither agent state nor a conversation row', async () => {
    const sessionId = 'conv-20260922-nobody';
    const token = await writePtyToken(sessionId);

    const res = await postLifecycle({ event: 'exited', at: '2026-09-22T14:00:00.000Z' }, token, sessionId);
    expect(res.status).toBe(404);
  });
});
