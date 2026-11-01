/**
 * PAN-4404 WI-8: the SSH machine routes — channel refusal, strict bodies, the
 * D-4404-9 statuses, a successful add, and the config-host suggestions. The
 * service, auth and channel checks are mocked.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addSshMachine: vi.fn(),
  testSshHost: vi.fn(),
  listSshConfigAliases: vi.fn(),
  channelOfRequest: vi.fn(),
  emitActivityEntry: vi.fn(),
}));

vi.mock('../../services/ssh-machine-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/ssh-machine-service.js')>()),
  addSshMachine: mocks.addSshMachine,
  testSshHost: mocks.testSshHost,
}));
vi.mock('../../../../lib/anywhere/ssh/target.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/anywhere/ssh/target.js')>()),
  listSshConfigAliases: mocks.listSshConfigAliases,
}));
vi.mock('../../channel-peer.js', () => ({ channelOfRequest: mocks.channelOfRequest }));
vi.mock('../dashboard-auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../dashboard-auth.js')>()),
  rejectUnauthorizedDashboardRequest: () => null,
  rejectUnsafeDashboardMutationRequest: () => null,
}));
vi.mock('../../../../lib/activity-logger.js', () => ({ emitActivityEntry: mocks.emitActivityEntry }));

const { SshMachineError } = await import('../../../../lib/anywhere/ssh/target.js');
const { machinesSshRouteLayer } = await import('../machines-ssh.js');

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const req = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(machinesSshRouteLayer), (app) =>
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

describe('SSH machine routes (PAN-4404 WI-8)', () => {
  it('refuses a request that arrives through a secure channel', async () => {
    mocks.channelOfRequest.mockReturnValue({ peer: 'x' });
    expect((await call('POST', '/api/machines/ssh', { host: 'desk' })).status).toBe(403);
    expect((await call('POST', '/api/machines/ssh/test', { host: 'desk' })).status).toBe(403);
    expect((await call('GET', '/api/machines/ssh/config-hosts')).status).toBe(403);
    expect(mocks.addSshMachine).not.toHaveBeenCalled();
  });

  it('answers 400 for a body without host or with wrong types', async () => {
    expect((await call('POST', '/api/machines/ssh', {})).status).toBe(400);
    expect((await call('POST', '/api/machines/ssh', { host: 'desk', bothWays: 'yes' })).status).toBe(400);
    expect((await call('POST', '/api/machines/ssh', { host: 'desk', access: 'root' })).status).toBe(400);
    expect((await call('POST', '/api/machines/ssh', 'not json')).status).toBe(400);
    expect((await call('POST', '/api/machines/ssh/test', { host: 42 })).status).toBe(400);
    expect(mocks.addSshMachine).not.toHaveBeenCalled();
  });

  it('maps version-mismatch from the service to 409 with that code', async () => {
    mocks.addSshMachine.mockRejectedValue(new SshMachineError('version-mismatch', 'desk has pan 0.71.0', { remoteVersion: '0.71.0' }));
    const result = await call('POST', '/api/machines/ssh', { host: 'desk' });
    expect(result).toEqual({ status: 409, body: { error: 'version-mismatch', message: 'desk has pan 0.71.0', detail: { remoteVersion: '0.71.0' } } });
  });

  it('answers 200 with the view on success and passes defaults to the service', async () => {
    const view = { id: 'link-1', label: 'desk', ssh: { destination: 'desk', launch: 'managed' } };
    mocks.addSshMachine.mockResolvedValue({
      link: { id: 'link-1', label: 'desk', environmentId: 'env', access: 'operator' },
      view,
      record: { destination: 'desk', launch: 'managed' },
    });
    const result = await call('POST', '/api/machines/ssh', { host: 'desk' });
    expect(result).toEqual({ status: 200, body: view });
    expect(mocks.addSshMachine).toHaveBeenCalledWith({ host: 'desk', panPath: null, bothWays: true, access: 'operator' });
    expect(mocks.emitActivityEntry.mock.calls[0]![0]).toMatchObject({ message: 'Added SSH machine "desk" (desk, managed)' });
  });

  it('test answers the result body, and bad-destination or busy with their status', async () => {
    mocks.testSshHost.mockResolvedValue({ reachable: false, panVersion: null, localVersion: '0.72.0', versionMatches: false, error: 'auth-failed', message: 'refused' });
    expect(await call('POST', '/api/machines/ssh/test', { host: 'desk', panPath: '/opt/pan' })).toMatchObject({ status: 200, body: { error: 'auth-failed' } });
    expect(mocks.testSshHost).toHaveBeenCalledWith({ host: 'desk', panPath: '/opt/pan' });
    mocks.testSshHost.mockRejectedValue(new SshMachineError('busy', 'busy'));
    expect((await call('POST', '/api/machines/ssh/test', { host: 'desk' })).status).toBe(409);
    mocks.testSshHost.mockRejectedValue(new SshMachineError('bad-destination', 'bad'));
    expect((await call('POST', '/api/machines/ssh/test', { host: 'desk;' })).status).toBe(400);
  });

  it('config-hosts answers the alias list', async () => {
    mocks.listSshConfigAliases.mockResolvedValue(['build-box', 'desk']);
    expect(await call('GET', '/api/machines/ssh/config-hosts')).toEqual({ status: 200, body: { hosts: ['build-box', 'desk'] } });
  });
});
