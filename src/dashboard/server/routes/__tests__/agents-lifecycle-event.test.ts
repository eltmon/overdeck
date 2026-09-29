/**
 * Tests for the agent stop/delete lifecycle event parameterization (PAN-1221 F1)
 *
 * Verifies that DELETE /api/agents/:id emits 'agent.delete_requested' and
 * POST /api/agents/:id/stop emits 'agent.stop_requested' to the lifecycle log.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Context, Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { EventStoreService } from '../../services/domain-services.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockAppendFile = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    appendFile: mockAppendFile,
    mkdir: mockMkdir,
  };
});

vi.mock('../../../../lib/agents.js', () => ({
  getAgentState: vi.fn(),
  getAgentStateProgram: vi.fn(),
  stopAgent: vi.fn(),
  stopAgentProgram: vi.fn(),
}));

vi.mock('../../services/agent-projection.js', () => ({
  saveAgentStateAndEmitEventProgram: vi.fn(() => Effect.void),
}));

// PAN-4290: the stop route now also checks tmux liveness (for the
// agent.status_changed hasLivePane fold) — mock it so this stays a fast,
// hermetic unit test instead of spawning a real `tmux has-session`.
vi.mock('../../../../lib/tmux.js', () => ({
  sessionExists: vi.fn(() => Effect.succeed(false)),
}));

vi.mock('../../../../lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
}));

vi.mock('../origin-validation.js', () => ({
  validateOrigin: vi.fn(() => ({ ok: true })),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { createAgentStopHandler } from '../agents.js';
import { getAgentState, stopAgent } from '../../../../lib/agents.js';
import { saveAgentStateAndEmitEventProgram } from '../../services/agent-projection.js';

const mockGetAgentState = vi.mocked(getAgentState);
const mockStopAgent = vi.mocked(stopAgent);
const mockSaveAgentStateAndEmitEventProgram = vi.mocked(saveAgentStateAndEmitEventProgram);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function runAgentStopHandler(
  lifecycleEvent: 'agent.delete_requested' | 'agent.stop_requested',
  agentId = 'agent-pan-test',
) {
  const request = HttpServerRequest.fromWeb(
    new Request('http://localhost/api/agents/' + agentId, { method: 'POST' }),
  );

  const mockEventStore = {
    append: () =>
      Effect.sync(() => {
        return 1;
      }),
  };

  const ctx = Context.make(HttpServerRequest.HttpServerRequest, request).pipe(
    Context.add(HttpRouter.RouteContext, { params: { id: agentId }, route: {} as any }),
    Context.add(EventStoreService, mockEventStore as any),
  );

  const handler = createAgentStopHandler(lifecycleEvent);
  await Effect.runPromise(Effect.provide(handler, Layer.succeedContext(ctx)));
}

function getLastAppendedLogLine(): { event?: string } | null {
  const lastCall = mockAppendFile.mock.calls.at(-1);
  if (!lastCall) return null;
  const logLine = lastCall[1] as string;
  try {
    return JSON.parse(logLine.trim());
  } catch {
    return null;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createAgentStopHandler lifecycle events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentState.mockReturnValue({
      issueId: 'PAN-TEST',
      role: 'work',
    } as any);
    mockStopAgent.mockReturnValue(Effect.void);
    mockAppendFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  it("emits 'agent.delete_requested' for DELETE route", async () => {
    await runAgentStopHandler('agent.delete_requested');

    expect(mockAppendFile).toHaveBeenCalled();
    const log = getLastAppendedLogLine();
    expect(log?.event).toBe('agent.delete_requested');
  });

  it("emits 'agent.stop_requested' for POST /stop route", async () => {
    await runAgentStopHandler('agent.stop_requested');

    expect(mockAppendFile).toHaveBeenCalled();
    const log = getLastAppendedLogLine();
    expect(log?.event).toBe('agent.stop_requested');
  });

  it('calls stopAgentProgram and getAgentStateProgram', async () => {
    await runAgentStopHandler('agent.stop_requested', 'agent-pan-999');

    expect(mockGetAgentState).toHaveBeenCalledWith('agent-pan-999');
    expect(mockStopAgent).toHaveBeenCalledWith('agent-pan-999', 'operator');
  });

  it('routes agent.stopped through the transactional projection boundary', async () => {
    await runAgentStopHandler('agent.stop_requested');

    expect(mockSaveAgentStateAndEmitEventProgram).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'PAN-TEST' }),
      expect.objectContaining({ type: 'agent.stopped' }),
    );
  });

  it('PAN-4290: also emits agent.status_changed carrying stoppedByUser, so the live store folds it', async () => {
    // stopAgent (mocked as a no-op) is the code path that actually sets
    // stoppedByUser on disk; simulate that here so the emitted payload
    // reflects it.
    mockGetAgentState.mockReturnValue({
      id: 'agent-pan-test',
      issueId: 'PAN-TEST',
      role: 'work',
      status: 'stopped',
      stoppedByUser: true,
    } as any);

    await runAgentStopHandler('agent.stop_requested');

    expect(mockSaveAgentStateAndEmitEventProgram).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'PAN-TEST' }),
      expect.objectContaining({
        type: 'agent.status_changed',
        payload: expect.objectContaining({ agentId: 'agent-pan-test', stoppedByUser: true }),
      }),
    );
  });
});
