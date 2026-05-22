import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

// Helper: provider methods are Effect-returning post-migration.
const run = <A, E>(eff: Effect.Effect<A, E, never>): Promise<A> => Effect.runPromise(eff);

// Hoist mocks so they're available inside vi.mock factories
const { execAsyncMock, spawnMock, mockApi } = vi.hoisted(() => {
  const execAsyncMock = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
  const spawnMock = vi.fn();
  const mockApi = {
    createMachine: vi.fn(),
    destroyMachine: vi.fn(),
    startMachine: vi.fn(),
    stopMachine: vi.fn(),
    getMachine: vi.fn(),
    listMachines: vi.fn(),
    execCommand: vi.fn(),
    waitForState: vi.fn(),
    ensureApp: vi.fn(),
  };
  return { execAsyncMock, spawnMock, mockApi };
});

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  spawn: spawnMock,
}));
vi.mock('util', () => ({
  promisify: () => execAsyncMock,
}));

vi.mock('../../../src/lib/remote/fly-api.js', () => ({
  FlyApiClient: vi.fn(() => mockApi),
  FlyApiError: class FlyApiError extends Error { constructor(m: string, public statusCode: number, public body: string) { super(m); } },
  createFlyApiClient: vi.fn(() => mockApi),
}));

// Mock fs so resolveVm can't find workspace metadata
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: actual.readFileSync,
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

import { FlyProvider, createFlyProvider } from '../../../src/lib/remote/fly-provider.js';

describe('FlyProvider', () => {
  let provider: FlyProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FLY_API_TOKEN = 'test-token';
    provider = createFlyProvider({ app: 'test-app', org: 'test-org', region: 'iad' });

    // Default: resolveVm falls back to listing machines
    mockApi.listMachines.mockResolvedValue([
      { id: 'machine-1', name: 'test-vm', state: 'started', region: 'iad' }
    ]);
  });

  describe('name', () => {
    it('is "fly"', () => {
      expect(provider.name).toBe('fly');
    });
  });

  describe('createVm', () => {
    it('calls ensureApp then createMachine', async () => {
      mockApi.ensureApp.mockResolvedValue(undefined);
      mockApi.createMachine.mockResolvedValue({ id: 'new-machine', name: 'ws-123', state: 'started', region: 'iad' });
      mockApi.waitForState.mockResolvedValue(undefined);

      const result = await run((await Effect.runPromise(provider.createVm('ws-123'))));

      expect(mockApi.ensureApp).toHaveBeenCalledWith('test-app', 'test-org');
      expect(mockApi.createMachine).toHaveBeenCalledWith('test-app', 'ws-123', expect.objectContaining({
        image: expect.any(String),
      }));
      expect(result.machineId).toBe('new-machine');
      expect(result.name).toBe('ws-123');
    });
  });

  describe('deleteVm', () => {
    it('resolves vm then calls destroyMachine', async () => {
      mockApi.destroyMachine.mockResolvedValue(undefined);

      await run((await Effect.runPromise(provider.deleteVm('test-vm'))));

      expect(mockApi.destroyMachine).toHaveBeenCalledWith('test-app', 'machine-1');
    });
  });

  describe('listVms', () => {
    it('returns mapped VmInfo array', async () => {
      mockApi.listMachines.mockResolvedValue([
        { id: 'm1', name: 'ws-1', state: 'started', region: 'iad' },
        { id: 'm2', name: 'ws-2', state: 'stopped', region: 'iad' },
      ]);

      const vms = await run((await Effect.runPromise(provider.listVms())));

      expect(vms).toHaveLength(2);
      expect(vms[0]).toMatchObject({ name: 'ws-1', status: 'running', machineId: 'm1' });
      expect(vms[1]).toMatchObject({ name: 'ws-2', status: 'stopped', machineId: 'm2' });
    });
  });

  describe('getStatus', () => {
    it('maps Fly states to VmStatus', async () => {
      mockApi.getMachine.mockResolvedValue({ id: 'm1', name: 'test-vm', state: 'started', region: 'iad' });
      expect(await run((await Effect.runPromise(provider.getStatus('test-vm'))))).toBe('running');
    });

    it('returns unknown on error', async () => {
      mockApi.listMachines.mockResolvedValue([]);
      expect(await run((await Effect.runPromise(provider.getStatus('nonexistent'))))).toBe('unknown');
    });
  });

  describe('ssh', () => {
    it('calls Fly exec API with /bin/sh -c wrapper', async () => {
      mockApi.execCommand.mockResolvedValue({ stdout: 'output', stderr: '', exit_code: 0 });

      const result = await run((await Effect.runPromise(provider.ssh('test-vm', 'echo hello'))));

      expect(mockApi.execCommand).toHaveBeenCalledWith(
        'test-app', 'machine-1', ['/bin/sh', '-c', 'echo hello'], expect.any(Number)
      );
      expect(result.stdout).toBe('output');
      expect(result.exitCode).toBe(0);
    });

    it('returns exit code 1 on FlyApiError', async () => {
      const { FlyApiError } = await import('../../../src/lib/remote/fly-api.js');
      mockApi.execCommand.mockRejectedValue(new FlyApiError('exec failed', 500, 'error'));

      const result = await run((await Effect.runPromise(provider.ssh('test-vm', 'bad-cmd'))));
      expect(result.exitCode).toBe(1);
    });
  });

  describe('exposePort', () => {
    it('throws NotImplementedError', async () => {
      await expect(run((await Effect.runPromise(provider.exposePort('test-vm', 3000))))).rejects.toThrow('not supported');
    });
  });

  describe('getAppName', () => {
    it('returns configured app name', () => {
      expect(provider.getAppName()).toBe('test-app');
    });
  });

  describe('mapFlyStateToVmStatus', () => {
    // Test through listVms which uses the mapping
    it('maps started → running', async () => {
      mockApi.listMachines.mockResolvedValue([{ id: 'm1', name: 'vm', state: 'started', region: 'iad' }]);
      const [vm] = await run((await Effect.runPromise(provider.listVms())));
      expect(vm.status).toBe('running');
    });

    it('maps stopped → stopped', async () => {
      mockApi.listMachines.mockResolvedValue([{ id: 'm1', name: 'vm', state: 'stopped', region: 'iad' }]);
      const [vm] = await run((await Effect.runPromise(provider.listVms())));
      expect(vm.status).toBe('stopped');
    });

    it('maps destroying → deleting', async () => {
      mockApi.listMachines.mockResolvedValue([{ id: 'm1', name: 'vm', state: 'destroying', region: 'iad' }]);
      const [vm] = await run((await Effect.runPromise(provider.listVms())));
      expect(vm.status).toBe('deleting');
    });
  });
});

describe('createFlyProvider', () => {
  it('creates a FlyProvider with defaults', () => {
    process.env.FLY_API_TOKEN = 'test-token';
    const p = createFlyProvider();
    expect(p).toBeInstanceOf(FlyProvider);
    expect(p.name).toBe('fly');
    expect(p.getAppName()).toBe('pan-workspaces');
  });
});

import { createFlyProviderFromConfig } from '../../../src/lib/remote/index.js';

describe('createFlyProviderFromConfig', () => {
  beforeEach(() => {
    process.env.FLY_API_TOKEN = 'test-token';
  });

  it('creates FlyProvider with defaults when no config provided', () => {
    const fly = createFlyProviderFromConfig();
    expect(fly).toBeInstanceOf(FlyProvider);
    expect(fly.getAppName()).toBe('pan-workspaces');
  });

  it('maps fly config fields to FlyProvider options', () => {
    const fly = createFlyProviderFromConfig({
      fly: {
        app: 'my-app',
        org: 'my-org',
        region: 'lax',
        vm_size: 'shared-cpu-4x',
        vm_memory: 2048,
        image: 'registry.fly.io/custom:v1',
        api_token_env: 'FLY_API_TOKEN',
      },
    });
    expect(fly.getAppName()).toBe('my-app');
  });

  it('uses api_token_env to resolve token', () => {
    process.env.CUSTOM_FLY_TOKEN = 'custom-token';
    const fly = createFlyProviderFromConfig({
      fly: { api_token_env: 'CUSTOM_FLY_TOKEN' },
    });
    expect(fly).toBeInstanceOf(FlyProvider);
    delete process.env.CUSTOM_FLY_TOKEN;
  });
});

describe('resolveVm — public method', () => {
  let provider: FlyProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FLY_API_TOKEN = 'test-token';
    provider = createFlyProvider({ app: 'test-app', org: 'test-org', region: 'iad' });
  });

  it('falls back to API listing when no workspace metadata found', async () => {
    mockApi.listMachines.mockResolvedValue([
      { id: 'machine-1', name: 'test-vm', state: 'started', region: 'iad' }
    ]);
    // resolveVm is now public
    const result = await provider.resolveVm('test-vm');
    expect(result.appName).toBe('test-app');
    expect(result.machineId).toBe('machine-1');
  });

  it('throws when vm not found', async () => {
    mockApi.listMachines.mockResolvedValue([]);
    await expect(provider.resolveVm('nonexistent')).rejects.toThrow('No Fly machine found');
  });
});
