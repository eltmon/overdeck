/**
 * PAN-4652 WI-7: provisioning a Fly machine against a fake Machines API — the
 * step order, the D-3 service and D-12 memory, the D-4 server env, the D-6
 * identity, the D-7 version install, the D-8 Docker probe, the pairing code,
 * and destroy-on-failure. Every poll runs under fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FlyApiError, type FlyExecResult, type FlyMachineConfig } from '../../../remote/fly-api.js';
import { destroyFlyVm, FlyMachineError, type FlyMachineApi, type FlyProvisionDeps, provisionFlyMachine } from '../provision.js';

const HOME_VERSION = '0.72.0';
const MACHINE_ID = '148e21ea7e1689';
const ENV_ID = '3f2c1b7e-9a4d-4c2b-8e1f-0a1b2c3d4e5f';
const PAIRING = `odp_${'ab'.repeat(32)}`;

type Responder = (command: string) => Partial<FlyExecResult> | undefined;

interface Harness {
  deps: Partial<FlyProvisionDeps>;
  events: string[];
  execs: string[];
  files: Map<string, string>;
  createConfig: () => FlyMachineConfig;
  destroyMachine: ReturnType<typeof vi.fn>;
}

function harness(respond: Responder = () => undefined): Harness {
  const events: string[] = [];
  const execs: string[] = [];
  const files = new Map<string, string>();
  let created: FlyMachineConfig | null = null;
  const destroyMachine = vi.fn(async () => { events.push('destroy'); });
  const ok = (stdout = ''): FlyExecResult => ({ stdout, stderr: '', exit_code: 0 });
  const defaults = (command: string): FlyExecResult => {
    if (command === 'pan --version') return ok(`${HOME_VERSION}\n`);
    // Fly's exec shell runs with HOME=/ (seen live), so the probe prints //.overdeck.
    if (command.startsWith('printf %s "${OVERDECK_HOME:-')) return ok('//.overdeck');
    if (command === 'pan pair --json') return ok(`${JSON.stringify({ url: `http://localhost:3011/#pair=${PAIRING}`, credential: PAIRING, expiresAt: '2026-11-01T01:00:00Z' })}\n`);
    return ok();
  };
  const api: FlyMachineApi = {
    ensureApp: vi.fn(async () => { events.push('ensureApp'); }),
    createMachine: vi.fn(async (_app: string, name: string, config: FlyMachineConfig) => {
      events.push('createMachine');
      created = config;
      return { id: MACHINE_ID, name, state: 'created', region: config.region ?? 'iad' };
    }),
    waitForState: vi.fn(async () => { events.push('waitForState'); }),
    execCommand: vi.fn(async (_app: string, _id: string, command: string[]) => {
      const script = command[2]!;
      execs.push(script);
      events.push(`exec:${script}`);
      return { ...defaults(script), ...respond(script) };
    }),
    destroyMachine,
  };
  return {
    events,
    execs,
    files,
    createConfig: () => created!,
    destroyMachine,
    deps: {
      api,
      flyConfig: { app: 'overdeck-ws', org: 'acme', vm_memory: 1024 },
      syncAllCredentials: vi.fn(async () => { events.push('syncAllCredentials'); return { claude: true, github: true }; }),
      configureClaudeCode: vi.fn(async () => { events.push('configureClaudeCode'); }),
      writeRemoteFile: vi.fn(async (_name: string, path: string, content: string) => {
        events.push(`write:${path}`);
        files.set(path, content);
      }),
      localVersion: async () => HOME_VERSION,
      newId: () => ENV_ID,
      machineSuffix: () => '1a2b3c4d',
      log: () => undefined,
      homeCodex: async () => null,
    },
  };
}

const indexOf = (events: string[], match: (event: string) => boolean): number => events.findIndex(match);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('provisionFlyMachine (PAN-4652 WI-7)', () => {
  it('runs steps 1-11 in order and returns the route, pairing code and identity', async () => {
    const h = harness();
    const result = await provisionFlyMachine({}, h.deps);

    expect(result).toEqual({
      machineId: MACHINE_ID,
      machineName: 'overdeck-machine-1a2b3c4d',
      appName: 'overdeck-ws',
      region: 'iad',
      label: `fly-${MACHINE_ID}`,
      environmentId: ENV_ID,
      docker: true,
      pairingCode: PAIRING,
      routeUrl: `wss://overdeck-ws.fly.dev/ws/link?fly-instance=${MACHINE_ID}`,
      codexAuthPath: null,
    });
    expect(h.createConfig().services).toEqual([{ protocol: 'tcp', internal_port: 3011, ports: [{ port: 443, handlers: ['tls', 'http'] }] }]);
    expect(h.createConfig().memory).toBeGreaterThanOrEqual(2048);
    expect(h.createConfig().restart).toEqual({ policy: 'no' });

    const steps = [
      (e: string) => e === 'ensureApp',
      (e: string) => e === 'createMachine',
      (e: string) => e === 'waitForState',
      (e: string) => e === 'exec:pan --version',
      (e: string) => e === 'write:/.overdeck/environment-id.json',
      (e: string) => e === 'syncAllCredentials',
      (e: string) => e === 'configureClaudeCode',
      (e: string) => e.startsWith('exec:') && e.includes('dockerd --storage-driver=vfs > /var/log/dockerd.log'),
      (e: string) => e.startsWith('exec:') && e.includes('pan serve'),
      (e: string) => e.startsWith('exec:curl'),
      (e: string) => e === 'write:/workspace/.pan/fly-machine-watchdog.js',
      (e: string) => e === 'exec:pan pair --json',
    ].map((match) => indexOf(h.events, match));
    expect(steps.every((index) => index >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(h.destroyMachine).not.toHaveBeenCalled();
  });

  it('defaults the image to registry.fly.io/<app>:latest', async () => {
    const h = harness();
    await provisionFlyMachine({}, h.deps);

    expect(h.createConfig().image).toBe('registry.fly.io/overdeck-ws:latest');
  });

  it('prefers --image, then [remote.fly] image, over the derived default', async () => {
    const explicit = harness();
    await provisionFlyMachine({ image: 'registry.fly.io/x:1' }, explicit.deps);
    expect(explicit.createConfig().image).toBe('registry.fly.io/x:1');

    const configured = harness();
    configured.deps.flyConfig = { ...configured.deps.flyConfig, image: 'registry.fly.io/y:2' };
    await provisionFlyMachine({}, configured.deps);
    expect(configured.createConfig().image).toBe('registry.fly.io/y:2');
  });

  it('starts pan serve with the D-4 env after writing the fly-<machineId> identity', async () => {
    const h = harness();
    await provisionFlyMachine({}, h.deps);

    const serve = h.execs.find((command) => command.includes('pan serve'))!;
    expect(serve).toContain('OVERDECK_TERMINAL_BACKEND=tmux IS_SANDBOX=1 OVERDECK_PUBLIC_LINK_ONLY=1');
    expect(serve).toContain('pan serve --port 3011 --no-open');
    expect(serve).not.toContain('OVERDECK_DISABLE_DEACON');
    expect(serve).toContain("> '/.overdeck/fly-serve.log'");
    expect(h.execs).toContain("chmod 600 '/.overdeck/environment-id.json'");

    const identity = JSON.parse(h.files.get('/.overdeck/environment-id.json')!) as Record<string, unknown>;
    expect(identity).toMatchObject({ v: 1, environmentId: ENV_ID, label: `fly-${MACHINE_ID}` });
    expect(typeof identity.createdAt).toBe('string');
    expect(h.events.indexOf('write:/.overdeck/environment-id.json')).toBeLessThan(h.events.findIndex((e) => e.includes('pan serve')));
  });

  it('installs home\'s version on a mismatch and fails with version-mismatch when it still differs', async () => {
    const h = harness((command) => {
      if (command === 'pan --version') return { stdout: '0.71.0\n' };
      if (command === 'cat /tmp/pan-install.exit') return { stdout: '1\n' };
      return undefined;
    });
    const settled = provisionFlyMachine({}, h.deps).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    const error = await settled;

    expect(error).toBeInstanceOf(FlyMachineError);
    expect(error).toMatchObject({ code: 'version-mismatch', detail: { home: HOME_VERSION, vm: '0.71.0' } });
    const install = h.execs.find((command) => command.includes('npm install -g'));
    expect(install).toContain(`@overdeck/core@${HOME_VERSION}`);
    expect(install?.startsWith('rm -f /tmp/pan-install.exit && setsid nohup sh -c')).toBe(true);
    expect(h.execs.filter((command) => command === 'pan --version')).toHaveLength(2);
    expect(h.execs.some((command) => command.includes('pan serve'))).toBe(false);
    expect(h.destroyMachine).toHaveBeenCalledWith('overdeck-ws', MACHINE_ID);
  });

  it('continues once the install brings the VM to home\'s version', async () => {
    let installed = false;
    const h = harness((command) => {
      if (command.includes('npm install -g')) installed = true;
      if (command === 'pan --version') return { stdout: installed ? `${HOME_VERSION}\n` : '0.71.0\n' };
      if (command === 'cat /tmp/pan-install.exit') return { stdout: installed ? '0\n' : '' };
      return undefined;
    });
    await expect(provisionFlyMachine({}, h.deps)).resolves.toMatchObject({ pairingCode: PAIRING });
  });

  it('fails with server-not-ready and the log tail when /api/health never answers within 120 s', async () => {
    const h = harness((command) => {
      if (command.startsWith('curl')) return { exit_code: 7, stderr: 'connection refused' };
      if (command.startsWith('tail -n 40')) return { stdout: 'Error: EADDRINUSE\n' };
      return undefined;
    });
    const settled = provisionFlyMachine({}, h.deps).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(119_000);
    expect(h.destroyMachine).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    const error = await settled;

    expect(error).toMatchObject({ code: 'server-not-ready' });
    expect((error as Error).message).toContain('Error: EADDRINUSE');
    expect(h.destroyMachine).toHaveBeenCalledWith('overdeck-ws', MACHINE_ID);
  });

  it('fails with pairing-failed when pan pair --json prints no credential', async () => {
    const h = harness((command) => (command === 'pan pair --json' ? { stdout: 'Dashboard not running\n' } : undefined));
    await expect(provisionFlyMachine({}, h.deps)).rejects.toMatchObject({ code: 'pairing-failed' });
    expect(h.destroyMachine).toHaveBeenCalledTimes(1);

    const bad = harness((command) => (command === 'pan pair --json' ? { stdout: '{"credential":"odp_short"}\n' } : undefined));
    await expect(provisionFlyMachine({}, bad.deps)).rejects.toMatchObject({ code: 'pairing-failed' });
  });

  it('resolves with docker: false when docker info never succeeds', async () => {
    const h = harness((command) => (command.startsWith('docker info') ? { exit_code: 1 } : undefined));
    const pending = provisionFlyMachine({}, h.deps);
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(pending).resolves.toMatchObject({ docker: false, pairingCode: PAIRING });
    expect(h.execs.some((command) => command.includes('pan serve'))).toBe(true);
    expect(h.destroyMachine).not.toHaveBeenCalled();
  });

  it('skips Docker when the image has no dockerd', async () => {
    const h = harness((command) => (command === 'command -v dockerd' ? { exit_code: 1 } : undefined));
    await expect(provisionFlyMachine({}, h.deps)).resolves.toMatchObject({ docker: false });
    expect(h.execs.some((command) => command.includes('dockerd --storage-driver'))).toBe(false);
  });
});

describe('destroyFlyVm (PAN-4652 WI-7)', () => {
  it('treats a 404 as already gone and rethrows any other error', async () => {
    const gone = { destroyMachine: vi.fn(async () => { throw new FlyApiError('not found', 404, ''); }) } as unknown as FlyMachineApi;
    await expect(destroyFlyVm('app', 'm1', { api: gone })).resolves.toBeUndefined();

    const broken = { destroyMachine: vi.fn(async () => { throw new FlyApiError('boom', 500, ''); }) } as unknown as FlyMachineApi;
    await expect(destroyFlyVm('app', 'm1', { api: broken })).rejects.toThrow('boom');
  });

  it('fails with credentials-failed and destroys the VM when Claude credentials did not reach it', async () => {
    const h = harness();
    h.deps.syncAllCredentials = vi.fn(async () => ({ claude: false, github: true }));
    await expect(provisionFlyMachine({}, h.deps)).rejects.toMatchObject({ code: 'credentials-failed' });
    expect(h.execs.some((command) => command.includes('pan serve'))).toBe(false);
    expect(h.destroyMachine).toHaveBeenCalledWith('overdeck-ws', MACHINE_ID);
  });

  it('logs and continues when only the GitHub auth did not reach the VM', async () => {
    const h = harness();
    const log = vi.fn();
    h.deps.syncAllCredentials = vi.fn(async () => ({ claude: true, github: false }));
    h.deps.log = log;
    await expect(provisionFlyMachine({}, h.deps)).resolves.toMatchObject({ pairingCode: PAIRING });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Could not copy GitHub auth'));
  });
});

describe('onCreated hook (review of PR #4742)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('reports the machine as soon as it exists, before preparing it', async () => {
    const h = harness();
    const onCreated = vi.fn(async () => { h.events.push('onCreated'); });
    await provisionFlyMachine({}, h.deps, { onCreated });
    expect(onCreated).toHaveBeenCalledWith({ machineId: MACHINE_ID, machineName: 'overdeck-machine-1a2b3c4d', appName: 'overdeck-ws', region: 'iad' });
    expect(h.events.indexOf('onCreated')).toBe(h.events.indexOf('createMachine') + 1);
  });

  it('destroys the VM when the hook fails', async () => {
    const h = harness();
    await expect(provisionFlyMachine({}, h.deps, { onCreated: async () => { throw new Error('disk full'); } })).rejects.toThrow('disk full');
    expect(h.destroyMachine).toHaveBeenCalledWith('overdeck-ws', MACHINE_ID);
  });
});

describe('Codex on a Fly machine (PAN-4296 WI-4)', () => {
  const CODEX_VERSION = '0.166.0';
  const AUTH = JSON.stringify({ tokens: { access_token: 'a', id_token: 'i', refresh_token: 'r', account_id: 'acct-1' }, last_refresh: '2026-11-01T10:00:00.000Z' });
  const homeCodex = async () => ({ binary: '/usr/bin/codex', version: CODEX_VERSION, authRaw: AUTH });
  const codexVm = (vmVersion = CODEX_VERSION): Responder => (command) => {
    if (command === 'printf %s "$HOME/.codex"') return { stdout: '//.codex' };
    if (command === 'codex --version') return { stdout: `codex-cli ${vmVersion}\n` };
    return undefined;
  };
  const isPush = (command: string) => command.includes('base64 -d');

  it('probes $HOME/.codex, pushes the sign-in there and returns its path', async () => {
    const h = harness(codexVm());
    h.deps.homeCodex = homeCodex;
    const result = await provisionFlyMachine({ harness: 'codex' }, h.deps);

    expect(result.codexAuthPath).toBe('/.codex/auth.json');
    const probe = h.execs.indexOf('printf %s "$HOME/.codex"');
    const push = h.execs.findIndex(isPush);
    expect(probe).toBeGreaterThanOrEqual(0);
    expect(push).toBeGreaterThan(probe);
    expect(h.execs[push]).toContain(`printf %s '${Buffer.from(AUTH).toString('base64')}' | base64 -d > '/.codex/auth.json.tmp'`);
    expect(h.execs[push]).toContain("mv -f '/.codex/auth.json.tmp' '/.codex/auth.json'");
    expect(h.events.indexOf('configureClaudeCode')).toBeLessThan(h.events.indexOf(`exec:${h.execs[push]}`));
    expect(h.execs.some((command) => command.includes('@openai/codex@'))).toBe(false);
  });

  it('succeeds for a Codex machine when the Claude credentials did not reach it', async () => {
    const h = harness(codexVm());
    const log = vi.fn();
    h.deps.homeCodex = homeCodex;
    h.deps.log = log;
    h.deps.syncAllCredentials = vi.fn(async () => ({ claude: false, github: true }));
    await expect(provisionFlyMachine({ harness: 'codex' }, h.deps)).resolves.toMatchObject({ codexAuthPath: '/.codex/auth.json' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Could not copy Claude Code credentials'));
    expect(h.destroyMachine).not.toHaveBeenCalled();
  });

  it('skips Codex for a Claude Code machine when home has no Codex', async () => {
    const h = harness(codexVm());
    await expect(provisionFlyMachine({}, h.deps)).resolves.toMatchObject({ codexAuthPath: null, pairingCode: PAIRING });
    expect(h.execs.some((command) => command.includes('.codex') || command.startsWith('codex'))).toBe(false);
  });

  it('fails a Codex machine with credentials-failed and destroys it when home has no Codex', async () => {
    const h = harness(codexVm());
    await expect(provisionFlyMachine({ harness: 'codex' }, h.deps)).rejects.toMatchObject({ code: 'credentials-failed' });
    expect(h.execs.some((command) => command.includes('pan serve'))).toBe(false);
    expect(h.destroyMachine).toHaveBeenCalledWith('overdeck-ws', MACHINE_ID);
  });

  it('installs home\'s Codex on a mismatch and fails a Codex machine when it still differs', async () => {
    const h = harness((command) => {
      if (command === 'cat /tmp/codex-install.exit') return { stdout: '1\n' };
      return codexVm('0.150.0')(command);
    });
    h.deps.homeCodex = homeCodex;
    const settled = provisionFlyMachine({ harness: 'codex' }, h.deps).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    const error = await settled;

    expect(error).toBeInstanceOf(FlyMachineError);
    expect(error).toMatchObject({ code: 'version-mismatch', detail: { home: CODEX_VERSION, vm: '0.150.0' } });
    const install = h.execs.find((command) => command.includes('@openai/codex@'))!;
    expect(install).toContain(`@openai/codex@${CODEX_VERSION}`);
    expect(install.startsWith('rm -f /tmp/codex-install.exit && setsid nohup sh -c')).toBe(true);
    expect(h.execs.filter((command) => command === 'codex --version')).toHaveLength(2);
    expect(h.execs.some(isPush)).toBe(false);
    expect(h.destroyMachine).toHaveBeenCalledWith('overdeck-ws', MACHINE_ID);
  });

  it('polls the detached install until it finishes, then pushes', async () => {
    let installed = false;
    const h = harness((command) => {
      if (command.includes('@openai/codex@')) return undefined;
      if (command === 'cat /tmp/codex-install.exit') {
        installed = true;
        return { stdout: '0\n' };
      }
      return codexVm(installed ? CODEX_VERSION : '0.150.0')(command);
    });
    h.deps.homeCodex = homeCodex;
    await expect(provisionFlyMachine({ harness: 'codex' }, h.deps)).resolves.toMatchObject({ codexAuthPath: '/.codex/auth.json' });
    expect(h.execs.some(isPush)).toBe(true);
  });

  it('keeps a Claude Code machine with codexAuthPath: null when the Codex version still differs', async () => {
    const h = harness((command) => {
      if (command === 'cat /tmp/codex-install.exit') return { stdout: '1\n' };
      return codexVm('0.150.0')(command);
    });
    const log = vi.fn();
    h.deps.homeCodex = homeCodex;
    h.deps.log = log;
    const pending = provisionFlyMachine({}, h.deps);
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toMatchObject({ codexAuthPath: null, pairingCode: PAIRING });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('@openai/codex@0.166.0 did not fix it'));
    expect(h.execs.some(isPush)).toBe(false);
    expect(h.destroyMachine).not.toHaveBeenCalled();
  });

  it('fails a Codex machine with credentials-failed when the push fails, naming no sign-in content', async () => {
    const h = harness((command) => (isPush(command) ? { exit_code: 1, stderr: AUTH } : codexVm()(command)));
    h.deps.homeCodex = homeCodex;
    const error = await provisionFlyMachine({ harness: 'codex' }, h.deps).catch((caught: unknown) => caught as FlyMachineError);
    expect(error).toMatchObject({ code: 'credentials-failed' });
    expect(error.message).toContain('/.codex/auth.json');
    expect(error.message).not.toContain('acct-1');
    expect(h.destroyMachine).toHaveBeenCalledWith('overdeck-ws', MACHINE_ID);
  });
});
