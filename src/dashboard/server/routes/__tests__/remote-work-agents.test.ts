/**
 * PAN-4734 WI-8: POST /api/remote/work-agents — channel refusal, strict
 * bodies, the service's error statuses and a successful start. The service,
 * auth and channel checks are mocked.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startFlyWorkAgent: vi.fn(),
  channelOfRequest: vi.fn(),
  emitActivityEntry: vi.fn(),
}));

vi.mock('../../services/fly-work-agent-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/fly-work-agent-service.js')>()),
  startFlyWorkAgent: mocks.startFlyWorkAgent,
}));
vi.mock('../../channel-peer.js', () => ({ channelOfRequest: mocks.channelOfRequest }));
vi.mock('../dashboard-auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../dashboard-auth.js')>()),
  rejectUnauthorizedDashboardRequest: () => null,
  rejectUnsafeDashboardMutationRequest: () => null,
}));
vi.mock('../../../../lib/activity-logger.js', () => ({ emitActivityEntry: mocks.emitActivityEntry }));

const { FlyWorkAgentError } = await import('../../services/fly-work-agent-service.js');
const { FlyMachineError } = await import('../../../../lib/anywhere/fly/provision.js');
const { remoteWorkAgentsRouteLayer } = await import('../remote-work-agents.js');

const ENV = '3f2c1b7e-9a4d-4c2b-8e1f-0a1b2c3d4e5f';

async function call(body?: unknown): Promise<{ status: number; body: any }> {
  const req = HttpServerRequest.fromWeb(
    new Request('http://localhost/api/remote/work-agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(remoteWorkAgentsRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.channelOfRequest.mockReturnValue(null);
});

describe('POST /api/remote/work-agents (PAN-4734 WI-8)', () => {
  it('refuses a request that arrives through a secure channel', async () => {
    mocks.channelOfRequest.mockReturnValue({ mode: 'link' });
    const { status, body } = await call({ issueId: 'PAN-1' });
    expect(status).toBe(403);
    expect(body.error).toBe('a linked machine cannot start Fly work agents here');
    expect(mocks.startFlyWorkAgent).not.toHaveBeenCalled();
  });

  it('answers 400 for a missing or malformed issueId and other bad fields', async () => {
    expect((await call({})).status).toBe(400);
    expect((await call({ issueId: 'not an issue' })).status).toBe(400);
    expect((await call({ issueId: 'PAN-1', model: 42 })).status).toBe(400);
    expect((await call({ issueId: 'PAN-1', autoSpawnConsentRequired: 'yes' })).status).toBe(400);
    expect((await call('not json')).status).toBe(400);
    expect(mocks.startFlyWorkAgent).not.toHaveBeenCalled();
  });

  it('maps already-running to 409 with its message', async () => {
    mocks.startFlyWorkAgent.mockRejectedValue(new FlyWorkAgentError('already-running', 'A work agent for PAN-1 is already running.'));
    const { status, body } = await call({ issueId: 'PAN-1' });
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'already-running', message: 'A work agent for PAN-1 is already running.' });
  });

  it('maps a Fly machine error to its status and anything else to 500', async () => {
    mocks.startFlyWorkAgent.mockRejectedValueOnce(new FlyMachineError('workspace-failed', 'no such ref'));
    expect((await call({ issueId: 'PAN-1' })).status).toBe(502);
    mocks.startFlyWorkAgent.mockRejectedValueOnce(new Error('boom'));
    expect(await call({ issueId: 'PAN-1' })).toEqual({ status: 500, body: { error: 'fly-work-failed', message: 'boom' } });
  });

  it('starts the agent with the dashboard operator as the default starter and answers 201', async () => {
    const result = {
      issueId: 'PAN-1', agentId: 'agent-pan-1', environmentId: ENV, name: '20261102-1234',
      path: `/conv/@${ENV}/20261102-1234`, machine: 'fly-m1',
    };
    mocks.startFlyWorkAgent.mockResolvedValue(result);

    const { status, body } = await call({ issueId: 'pan-1', model: 'claude-opus-5-5' });

    expect(status).toBe(201);
    expect(body).toEqual(result);
    expect(mocks.startFlyWorkAgent).toHaveBeenCalledWith(
      { issueId: 'pan-1', model: 'claude-opus-5-5', startedBy: 'operator:dashboard' },
      { notifyLinksChanged: expect.any(Function), unlink: expect.any(Function) },
    );
    expect(mocks.emitActivityEntry).toHaveBeenCalledTimes(1);
  });

  it('passes a caller startedBy and the consent flag through', async () => {
    mocks.startFlyWorkAgent.mockResolvedValue({ issueId: 'PAN-1', agentId: 'agent-pan-1', environmentId: ENV, name: 'n', path: '/conv/x', machine: 'fly-m1' });
    await call({ issueId: 'PAN-1', startedBy: 'flywheel', autoSpawnConsentRequired: true });
    expect(mocks.startFlyWorkAgent.mock.calls[0]![0]).toEqual({ issueId: 'PAN-1', startedBy: 'flywheel', autoSpawnConsentRequired: true });
  });
});
