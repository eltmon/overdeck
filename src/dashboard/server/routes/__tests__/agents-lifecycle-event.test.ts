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
  getAgentStateAsync: vi.fn(),
  stopAgentAsync: vi.fn(),
}));

vi.mock('../../../../lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
}));

vi.mock('../origin-validation.js', () => ({
  validateOrigin: vi.fn(() => ({ ok: true })),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { createAgentStopHandler } from '../agents.js';
import { getAgentStateAsync, stopAgentAsync } from '../../../../lib/agents.js';

const mockGetAgentStateAsync = vi.mocked(getAgentStateAsync);
const mockStopAgentAsync = vi.mocked(stopAgentAsync);

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
    mockGetAgentStateAsync.mockResolvedValue({
      issueId: 'PAN-TEST',
      role: 'work',
    } as any);
    mockStopAgentAsync.mockResolvedValue(undefined);
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

  it('calls stopAgentAsync and getAgentStateAsync', async () => {
    await runAgentStopHandler('agent.stop_requested', 'agent-pan-999');

    expect(mockGetAgentStateAsync).toHaveBeenCalledWith('agent-pan-999');
    expect(mockStopAgentAsync).toHaveBeenCalledWith('agent-pan-999');
  });
});
