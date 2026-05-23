import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FlyApiClient, FlyApiError, createFlyApiClientSync } from '../../../src/lib/remote/fly-api.js';

// Mock global fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function mockOk(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

function mockError(status: number, body = 'error') {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => body,
  });
}

describe('FlyApiClient', () => {
  let client: FlyApiClient;

  beforeEach(() => {
    fetchMock.mockReset();
    client = new FlyApiClient('test-token');
  });

  it('sets Authorization header on all requests', async () => {
    mockOk([]);
    await client.listMachines('my-app');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/apps/my-app/machines'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
    );
  });

  describe('createMachine', () => {
    it('POSTs to /apps/{app}/machines with name and config', async () => {
      const machine = { id: 'm1', name: 'ws-123', state: 'started', region: 'iad' };
      mockOk(machine);
      const result = await client.createMachine('my-app', 'ws-123', { image: 'registry.fly.io/pan-workspace:latest' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.machines.dev/v1/apps/my-app/machines',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.id).toBe('m1');
    });
  });

  describe('destroyMachine', () => {
    it('DELETEs with force=true', async () => {
      mockOk('');
      await client.destroyMachine('my-app', 'm1');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.machines.dev/v1/apps/my-app/machines/m1?force=true',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('startMachine', () => {
    it('POSTs to /start', async () => {
      mockOk({ id: 'm1', name: 'ws-123', state: 'started', region: 'iad' });
      await client.startMachine('my-app', 'm1');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.machines.dev/v1/apps/my-app/machines/m1/start',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('stopMachine', () => {
    it('POSTs to /stop', async () => {
      mockOk({ id: 'm1', name: 'ws-123', state: 'stopped', region: 'iad' });
      await client.stopMachine('my-app', 'm1');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.machines.dev/v1/apps/my-app/machines/m1/stop',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('getMachine', () => {
    it('makes GET and returns machine', async () => {
      const machine = { id: 'm1', name: 'ws-123', state: 'started', region: 'iad' };
      mockOk(machine);
      const result = await client.getMachine('my-app', 'm1');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.machines.dev/v1/apps/my-app/machines/m1',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result.id).toBe('m1');
    });
  });

  describe('listMachines', () => {
    it('returns empty array when API returns null', async () => {
      mockOk(null);
      const result = await client.listMachines('my-app');
      expect(result).toEqual([]);
    });

    it('returns machines array', async () => {
      const machines = [{ id: 'm1', name: 'ws-1', state: 'started', region: 'iad' }];
      mockOk(machines);
      const result = await client.listMachines('my-app');
      expect(result).toHaveLength(1);
    });
  });

  describe('execCommand', () => {
    it('POSTs command array to exec endpoint', async () => {
      mockOk({ stdout: 'hello', stderr: '', exit_code: 0 });
      await client.execCommand('my-app', 'm1', ['/bin/sh', '-c', 'echo hello']);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.machines.dev/v1/apps/my-app/machines/m1/exec',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"command"'),
        })
      );
    });
  });

  describe('waitForState', () => {
    it('makes GET with state and timeout params', async () => {
      mockOk({ id: 'm1', name: 'ws-123', state: 'started', region: 'iad' });
      await client.waitForState('my-app', 'm1', 'started', 30);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/apps/my-app/machines/m1/wait'),
        expect.objectContaining({ method: 'GET' })
      );
      const url: string = fetchMock.mock.calls[0][0];
      expect(url).toContain('state=started');
      expect(url).toContain('timeout=30');
    });
  });

  describe('ensureApp', () => {
    it('does nothing if app already exists', async () => {
      mockOk({ name: 'my-app' });
      await client.ensureApp('my-app', 'personal');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('creates app if 404', async () => {
      mockError(404);
      mockOk({ name: 'my-app' });
      await client.ensureApp('my-app', 'personal');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenLastCalledWith(
        'https://api.machines.dev/v1/apps',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('rethrows non-404 errors', async () => {
      mockError(500, 'internal error');
      await expect(client.ensureApp('my-app', 'personal')).rejects.toThrow(FlyApiError);
    });
  });

  describe('error handling', () => {
    it('throws FlyApiError with statusCode and body on non-ok response', async () => {
      mockError(403, 'forbidden');
      await expect(client.listMachines('my-app')).rejects.toThrow(FlyApiError);
      mockError(403, 'forbidden');
      await expect(client.listMachines('my-app').catch(e => e)).resolves.toMatchObject({
        statusCode: 403,
        body: 'forbidden',
      });
    });
  });
});

describe('createFlyApiClient', () => {
  const originalEnv = process.env.FLY_API_TOKEN;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FLY_API_TOKEN;
    } else {
      process.env.FLY_API_TOKEN = originalEnv;
    }
  });

  it('reads token from FLY_API_TOKEN env var', () => {
    process.env.FLY_API_TOKEN = 'env-token';
    const client = createFlyApiClientSync();
    expect(client).toBeInstanceOf(FlyApiClient);
  });

  it('uses explicit token over env var', () => {
    process.env.FLY_API_TOKEN = 'env-token';
    const client = createFlyApiClientSync('explicit-token');
    expect(client).toBeInstanceOf(FlyApiClient);
  });

  it('throws if no token available', () => {
    delete process.env.FLY_API_TOKEN;
    expect(() => createFlyApiClientSync()).toThrow('Fly API token not found');
  });
});
