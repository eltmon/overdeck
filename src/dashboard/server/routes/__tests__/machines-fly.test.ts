/**
 * PAN-4652 WI-13: POST /api/machines/fly — channel refusal, strict bodies, the
 * FlyMachineError statuses and a successful add. The service, auth and channel
 * checks are mocked.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addFlyMachine: vi.fn(),
  channelOfRequest: vi.fn(),
  emitActivityEntry: vi.fn(),
  enableRemoteInConfigToml: vi.fn(),
}));

vi.mock('../../services/fly-machine-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/fly-machine-service.js')>()),
  addFlyMachine: mocks.addFlyMachine,
}));
vi.mock('../../channel-peer.js', () => ({ channelOfRequest: mocks.channelOfRequest }));
vi.mock('../dashboard-auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../dashboard-auth.js')>()),
  rejectUnauthorizedDashboardRequest: () => null,
  rejectUnsafeDashboardMutationRequest: () => null,
}));
vi.mock('../../../../lib/activity-logger.js', () => ({ emitActivityEntry: mocks.emitActivityEntry }));
vi.mock('../../../../lib/remote-enabled.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/remote-enabled.js')>()),
  enableRemoteInConfigToml: mocks.enableRemoteInConfigToml,
}));

const { FlyMachineError } = await import('../../../../lib/anywhere/fly/provision.js');
const { RemoteEnableError } = await import('../../../../lib/remote-enabled.js');
const { machinesFlyRouteLayer, machinesFlyEnableRemoteRouteLayer } = await import('../machines-fly.js');

const ENV = '3f2c1b7e-9a4d-4c2b-8e1f-0a1b2c3d4e5f';

async function call(body?: unknown, path = '/api/machines/fly', layer = machinesFlyRouteLayer): Promise<{ status: number; body: any }> {
  const req = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(layer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

async function callEnableRemote(): Promise<{ status: number; body: any }> {
  return call(undefined, '/api/machines/fly/enable-remote', machinesFlyEnableRemoteRouteLayer);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.channelOfRequest.mockReturnValue(null);
});

describe('POST /api/machines/fly (PAN-4652 WI-13)', () => {
  it('refuses a request that arrives through a secure channel', async () => {
    mocks.channelOfRequest.mockReturnValue({ mode: 'link' });
    expect((await call({ projectKey: 'overdeck' })).status).toBe(403);
    expect(mocks.addFlyMachine).not.toHaveBeenCalled();
  });

  it('answers 400 for a bad body, including a message over 50,000 characters', async () => {
    expect((await call({ message: 'x'.repeat(50_001), projectKey: 'overdeck' })).status).toBe(400);
    expect((await call({ projectKey: 42 })).status).toBe(400);
    expect((await call({ region: '  ' })).status).toBe(400);
    expect((await call('not json')).status).toBe(400);
    expect((await call([])).status).toBe(400);
    expect(mocks.addFlyMachine).not.toHaveBeenCalled();
  });

  it('maps cap-reached to 409 with the cap message', async () => {
    mocks.addFlyMachine.mockRejectedValue(new FlyMachineError('cap-reached', 'Remote agent cap reached: 2/2 active remote agents and Fly machines.'));
    const { status, body } = await call({});
    expect(status).toBe(409);
    expect(body).toMatchObject({ error: 'cap-reached', message: 'Remote agent cap reached: 2/2 active remote agents and Fly machines.' });
  });

  it('maps the other service errors to their statuses', async () => {
    mocks.addFlyMachine.mockRejectedValueOnce(new FlyMachineError('harness-unsupported', 'Claude Code only'));
    expect((await call({ harness: 'codex' })).status).toBe(400);
    mocks.addFlyMachine.mockRejectedValueOnce(new FlyMachineError('server-not-ready', 'no health'));
    expect((await call({})).status).toBe(502);
    mocks.addFlyMachine.mockRejectedValueOnce(new Error('disk full'));
    expect(await call({})).toEqual({ status: 500, body: { error: 'fly-failed', message: 'disk full' } });
  });

  it('answers 201 with the link, record and conversation path, passing the link notifier', async () => {
    const conversation = { environmentId: ENV, name: 'conv-fly-1', path: `/conv/@${ENV}/conv-fly-1` };
    mocks.addFlyMachine.mockResolvedValue({
      link: { id: 'link-1', environmentId: ENV, label: 'fly-m1' },
      record: { id: 'rec-1', label: 'fly-m1', appName: 'overdeck-ws', region: 'iad', machineId: 'm1', projectKey: 'overdeck', docker: true },
      conversation,
    });
    const { status, body } = await call({ projectKey: 'overdeck', message: 'Fix it', model: 'claude-sonnet-5-5' });

    expect(status).toBe(201);
    expect(body.conversation.path).toBe(`/conv/@${ENV}/conv-fly-1`);
    expect(mocks.addFlyMachine).toHaveBeenCalledWith(
      { projectKey: 'overdeck', message: 'Fix it', model: 'claude-sonnet-5-5' },
      { notifyLinksChanged: expect.any(Function) },
    );
    expect(mocks.emitActivityEntry).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/machines/fly/enable-remote (PAN-4905)', () => {
  it('refuses a request that arrives through a secure channel', async () => {
    mocks.channelOfRequest.mockReturnValue({ mode: 'link' });
    expect((await callEnableRemote()).status).toBe(403);
    expect(mocks.enableRemoteInConfigToml).not.toHaveBeenCalled();
  });

  it('answers 200 with changed and configFile, and logs activity when changed', async () => {
    mocks.enableRemoteInConfigToml.mockResolvedValue({ changed: true, path: '/home/x/.overdeck/config.toml' });
    const { status, body } = await callEnableRemote();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, changed: true, configFile: '/home/x/.overdeck/config.toml' });
    expect(mocks.emitActivityEntry).toHaveBeenCalledTimes(1);
  });

  it('maps RemoteEnableError to 409 without logging activity', async () => {
    mocks.enableRemoteInConfigToml.mockRejectedValue(new RemoteEnableError('config.toml does not parse, so nothing was changed: bad'));
    const { status, body } = await callEnableRemote();
    expect(status).toBe(409);
    expect(body).toMatchObject({ error: 'remote-enable-failed', message: 'config.toml does not parse, so nothing was changed: bad' });
    expect(mocks.emitActivityEntry).not.toHaveBeenCalled();
  });
});
