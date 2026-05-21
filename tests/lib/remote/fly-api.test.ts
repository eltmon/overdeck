import { afterEach, beforeEach, describe, expect, it, vi } from '@effect/vitest';
import { Effect } from 'effect';
import { ConfigError } from '../../../src/lib/errors.js';
import { FlyApiClient, FlyApiError, createFlyApiClient } from '../../../src/lib/remote/fly-api.js';

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

  it.effect('sets Authorization header on all requests', () =>
    Effect.gen(function* () {
      mockOk([]);
      yield* client.listMachines('my-app');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/apps/my-app/machines'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        })
      );
    })
  );

  describe('createMachine', () => {
    it.effect('POSTs to /apps/{app}/machines with name and config', () =>
      Effect.gen(function* () {
        const machine = { id: 'm1', name: 'ws-123', state: 'started', region: 'iad' };
        mockOk(machine);
        const result = yield* client.createMachine('my-app', 'ws-123', {
          image: 'registry.fly.io/pan-workspace:latest',
        });
        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.machines.dev/v1/apps/my-app/machines',
          expect.objectContaining({ method: 'POST' })
        );
        expect(result.id).toBe('m1');
      })
    );
  });

  describe('destroyMachine', () => {
    it.effect('DELETEs with force=true', () =>
      Effect.gen(function* () {
        mockOk('');
        yield* client.destroyMachine('my-app', 'm1');
        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.machines.dev/v1/apps/my-app/machines/m1?force=true',
          expect.objectContaining({ method: 'DELETE' })
        );
      })
    );
  });

  describe('startMachine', () => {
    it.effect('POSTs to /start', () =>
      Effect.gen(function* () {
        mockOk({ id: 'm1', name: 'ws-123', state: 'started', region: 'iad' });
        yield* client.startMachine('my-app', 'm1');
        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.machines.dev/v1/apps/my-app/machines/m1/start',
          expect.objectContaining({ method: 'POST' })
        );
      })
    );
  });

  describe('stopMachine', () => {
    it.effect('POSTs to /stop', () =>
      Effect.gen(function* () {
        mockOk({ id: 'm1', name: 'ws-123', state: 'stopped', region: 'iad' });
        yield* client.stopMachine('my-app', 'm1');
        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.machines.dev/v1/apps/my-app/machines/m1/stop',
          expect.objectContaining({ method: 'POST' })
        );
      })
    );
  });

  describe('getMachine', () => {
    it.effect('makes GET and returns machine', () =>
      Effect.gen(function* () {
        const machine = { id: 'm1', name: 'ws-123', state: 'started', region: 'iad' };
        mockOk(machine);
        const result = yield* client.getMachine('my-app', 'm1');
        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.machines.dev/v1/apps/my-app/machines/m1',
          expect.objectContaining({ method: 'GET' })
        );
        expect(result.id).toBe('m1');
      })
    );
  });

  describe('listMachines', () => {
    it.effect('returns empty array when API returns null', () =>
      Effect.gen(function* () {
        mockOk(null);
        const result = yield* client.listMachines('my-app');
        expect(result).toEqual([]);
      })
    );

    it.effect('returns machines array', () =>
      Effect.gen(function* () {
        const machines = [{ id: 'm1', name: 'ws-1', state: 'started', region: 'iad' }];
        mockOk(machines);
        const result = yield* client.listMachines('my-app');
        expect(result).toHaveLength(1);
      })
    );
  });

  describe('execCommand', () => {
    it.effect('POSTs command array to exec endpoint', () =>
      Effect.gen(function* () {
        mockOk({ stdout: 'hello', stderr: '', exit_code: 0 });
        yield* client.execCommand('my-app', 'm1', ['/bin/sh', '-c', 'echo hello']);
        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.machines.dev/v1/apps/my-app/machines/m1/exec',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"command"'),
          })
        );
      })
    );
  });

  describe('waitForState', () => {
    it.effect('makes GET with state and timeout params', () =>
      Effect.gen(function* () {
        mockOk({ id: 'm1', name: 'ws-123', state: 'started', region: 'iad' });
        yield* client.waitForState('my-app', 'm1', 'started', 30);
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/apps/my-app/machines/m1/wait'),
          expect.objectContaining({ method: 'GET' })
        );
        const url: string = fetchMock.mock.calls[0][0];
        expect(url).toContain('state=started');
        expect(url).toContain('timeout=30');
      })
    );
  });

  describe('ensureApp', () => {
    it.effect('does nothing if app already exists', () =>
      Effect.gen(function* () {
        mockOk({ name: 'my-app' });
        yield* client.ensureApp('my-app', 'personal');
        expect(fetchMock).toHaveBeenCalledTimes(1);
      })
    );

    it.effect('creates app if 404', () =>
      Effect.gen(function* () {
        mockError(404);
        mockOk({ name: 'my-app' });
        yield* client.ensureApp('my-app', 'personal');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenLastCalledWith(
          'https://api.machines.dev/v1/apps',
          expect.objectContaining({ method: 'POST' })
        );
      })
    );

    it.effect('rethrows non-404 errors', () =>
      Effect.gen(function* () {
        mockError(500, 'internal error');
        const err = yield* Effect.flip(client.ensureApp('my-app', 'personal'));
        expect(err._tag).toBe('FlyApiError');
        expect((err as FlyApiError).statusCode).toBe(500);
      })
    );
  });

  describe('error handling', () => {
    it.effect('surfaces FlyApiError with statusCode and body on non-ok response', () =>
      Effect.gen(function* () {
        mockError(403, 'forbidden');
        const err = yield* Effect.flip(client.listMachines('my-app'));
        expect(err._tag).toBe('FlyApiError');
        expect((err as FlyApiError).statusCode).toBe(403);
        expect((err as FlyApiError).body).toBe('forbidden');
      })
    );
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

  it.effect('reads token from FLY_API_TOKEN env var', () =>
    Effect.gen(function* () {
      process.env.FLY_API_TOKEN = 'env-token';
      const client = yield* createFlyApiClient();
      expect(client).toBeInstanceOf(FlyApiClient);
    })
  );

  it.effect('uses explicit token over env var', () =>
    Effect.gen(function* () {
      process.env.FLY_API_TOKEN = 'env-token';
      const client = yield* createFlyApiClient('explicit-token');
      expect(client).toBeInstanceOf(FlyApiClient);
    })
  );

  it.effect('fails with ConfigError if no token available', () =>
    Effect.gen(function* () {
      delete process.env.FLY_API_TOKEN;
      const err = yield* Effect.flip(createFlyApiClient());
      expect(err._tag).toBe('ConfigError');
      expect((err as ConfigError).message).toContain('Fly API token not found');
    })
  );
});
