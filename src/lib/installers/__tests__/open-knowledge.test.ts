import { execFile, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureOpenKnowledge,
  executeOpenKnowledgeSetupPlan,
  getOpenKnowledgeStatus,
  OpenKnowledgeError,
  OpenKnowledgeSetupRequiredError,
  prepareOpenKnowledgeSnapshot,
  resolveOpenKnowledgeSetupPlan,
  startOpenKnowledgeServer,
  type CommandResult,
  type OpenKnowledgeSetupPlan,
} from '../open-knowledge.js';

const success = (stdout = ''): CommandResult => ({ stdout, stderr: '' });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ensureOpenKnowledge', () => {
  const home = '/home/tester';
  const shimPath = join(home, '.local', 'bin', 'ok');
  const nodePath = '/runtimes/node-v24.17.0/bin/node';
  const entryScript = '/runtimes/node-v24.17.0/lib/node_modules/@inkeep/open-knowledge/dist/cli.mjs';

  it('returns already-installed when ok --version succeeds', async () => {
    const runCommand = vi.fn(async () => success('0.34.0\n'));

    const result = await ensureOpenKnowledge({ runCommand, homedir: () => home });

    expect(result).toEqual({ status: 'already-installed', command: 'ok' });
    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith('ok', ['--version']);
  });

  it('installs under a resolved runtime, writes the shim, and polls it with fake timers', async () => {
    let shimChecks = 0;
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === 'ok') throw new Error('missing');
      if (command === shimPath && args[0] === '--version') {
        shimChecks += 1;
        if (shimChecks < 3) throw new Error('not ready');
        return success('0.34.0\n');
      }
      return success();
    });
    const resolveRuntime = vi.fn(async () => ({
      kind: 'runtime' as const,
      nodePath,
      source: 'nvm' as const,
    }));
    const writeShim = vi.fn(async () => shimPath);

    const resultPromise = ensureOpenKnowledge({
      autoInstall: true,
      retryDelayMs: 100,
      maxHealthAttempts: 3,
      env: { PATH: '/usr/bin' },
      homedir: () => home,
      runCommand,
      resolveRuntime,
      realpath: vi.fn(async () => entryScript),
      writeShim,
    });

    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result).toEqual({ status: 'installed', command: shimPath });
    expect(resolveRuntime).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith(
      '/runtimes/node-v24.17.0/bin/npm',
      ['install', '-g', '@inkeep/open-knowledge'],
      expect.objectContaining({ env: expect.objectContaining({ PATH: '/runtimes/node-v24.17.0/bin:/usr/bin' }) }),
    );
    expect(writeShim).toHaveBeenCalledWith({ nodePath, entryScript, shimPath });
    expect(shimChecks).toBe(3);
  });

  it('requires consent when Volta is installed without Node 24', async () => {
    const runCommand = vi.fn(async () => {
      throw new Error('missing');
    });
    const resolveRuntime = vi.fn(async () => ({
      kind: 'manager-without-24' as const,
      manager: 'volta' as const,
    }));

    const rejection = ensureOpenKnowledge({
      autoInstall: true,
      homedir: () => home,
      runCommand,
      resolveRuntime,
    });

    await expect(rejection).rejects.toBeInstanceOf(OpenKnowledgeSetupRequiredError);
    await expect(rejection).rejects.toMatchObject({
      plan: {
        kind: 'install-node-via-manager',
        manager: 'volta',
        installCommand: 'volta fetch node@24',
      },
    });
  });

  it('requires consent with an nvm plan when no version manager exists', async () => {
    const runCommand = vi.fn(async () => {
      throw new Error('missing');
    });
    const resolveRuntime = vi.fn(async () => ({ kind: 'none' as const }));

    const rejection = ensureOpenKnowledge({
      autoInstall: true,
      homedir: () => home,
      runCommand,
      resolveRuntime,
    });

    await expect(rejection).rejects.toBeInstanceOf(OpenKnowledgeSetupRequiredError);
    await expect(rejection).rejects.toMatchObject({ plan: { kind: 'install-nvm' } });
    await expect(rejection).rejects.toSatisfy((error: OpenKnowledgeSetupRequiredError) =>
      error.plan.steps.some((step) => step.includes('npm install -g @inkeep/open-knowledge')));
  });

  it('returns the absolute shim command when the bare ok probe fails', async () => {
    const runCommand = vi.fn(async (command: string) => {
      if (command === shimPath) return success('0.34.0\n');
      throw new Error('missing');
    });

    const result = await ensureOpenKnowledge({ runCommand, homedir: () => home });

    expect(result).toEqual({ status: 'already-installed', command: shimPath });
    expect(runCommand).toHaveBeenNthCalledWith(1, 'ok', ['--version']);
    expect(runCommand).toHaveBeenNthCalledWith(2, shimPath, ['--version']);
  });

  it('keeps autoInstall false strict and skips the setup resolver', async () => {
    const runCommand = vi.fn(async () => {
      throw new Error('missing');
    });
    const resolveSetupPlan = vi.fn<() => Promise<OpenKnowledgeSetupPlan>>();

    await expect(ensureOpenKnowledge({
      autoInstall: false,
      homedir: () => home,
      runCommand,
      resolveSetupPlan,
    })).rejects.toThrow('open-knowledge is not installed. Install it manually with `npm install -g @inkeep/open-knowledge`.');
    expect(resolveSetupPlan).not.toHaveBeenCalled();
  });

  it('preserves the Node 24 diagnosis when runtime installation fails', async () => {
    const runCommand = vi.fn(async (command: string) => {
      if (command === 'node') return success('v22.22.0\n');
      throw new Error('missing');
    });
    const executeSetupPlan = vi.fn(async () => {
      throw new Error('unsupported engine');
    });

    await expect(ensureOpenKnowledge({
      autoInstall: true,
      homedir: () => home,
      runCommand,
      resolveSetupPlan: async () => ({
        kind: 'install-under-runtime',
        source: 'override',
        nodePath,
        steps: [],
      }),
      executeSetupPlan,
    })).rejects.toThrow(
      "open-knowledge requires Node 24+; found v22.22.0. Install Node 24+ or run '/okf open --no-install' after installing manually.",
    );
  });
});

describe('executeOpenKnowledgeSetupPlan', () => {
  it('executes a manager install command, re-resolves the runtime, and installs the package', async () => {
    const nodePath = '/volta/tools/image/node/24.17.0/bin/node';
    const shimPath = '/home/tester/.local/bin/ok';
    const runCommand = vi.fn(async () => success());
    const resolveRuntime = vi.fn(async () => ({ kind: 'runtime' as const, nodePath, source: 'volta' as const }));
    const writeShim = vi.fn(async () => shimPath);

    const result = await executeOpenKnowledgeSetupPlan({
      kind: 'install-node-via-manager',
      manager: 'volta',
      installCommand: 'volta fetch node@24',
      steps: [],
    }, {
      env: { PATH: '/usr/bin' },
      runCommand,
      resolveRuntime,
      realpath: async () => '/volta/tools/image/node/24.17.0/bin/ok-target',
      writeShim,
      shimPath,
    });

    expect(result).toBe(shimPath);
    expect(runCommand).toHaveBeenCalledWith('bash', ['-c', 'volta fetch node@24']);
    expect(resolveRuntime).toHaveBeenCalledOnce();
    expect(writeShim).toHaveBeenCalledOnce();
  });

  it('installs nvm without profile edits and restores the pre-existing default alias after Node installation', async () => {
    const plan = await resolveOpenKnowledgeSetupPlan({
      homedir: () => '/home/tester',
      runCommand: vi.fn(async () => { throw new Error('missing'); }),
      resolveRuntime: vi.fn(async () => ({ kind: 'none' as const })),
    });
    expect(plan).toMatchObject({ kind: 'install-nvm' });
    if (plan.kind !== 'install-nvm') throw new Error('expected install-nvm plan');
    expect(plan.steps.join(' ')).toContain('PROFILE=/dev/null');

    const nodePath = '/home/tester/.nvm/versions/node/v24.17.0/bin/node';
    const runCommand = vi.fn(async () => success());
    const resolveRuntime = vi.fn()
      .mockResolvedValueOnce({ kind: 'manager-without-24', manager: 'nvm' })
      .mockResolvedValueOnce({ kind: 'runtime', nodePath, source: 'nvm' });

    await executeOpenKnowledgeSetupPlan(plan, {
      env: { PATH: '/usr/bin' },
      homedir: () => '/home/tester',
      runCommand,
      resolveRuntime,
      realpath: async () => '/home/tester/.nvm/versions/node/v24.17.0/bin/ok-target',
      writeShim: async () => '/home/tester/.local/bin/ok',
    });

    const setupCommands = runCommand.mock.calls
      .filter(([command]) => command === 'bash')
      .map(([, args]) => args[1]);
    expect(setupCommands[0]).toContain('PROFILE=/dev/null');
    expect(setupCommands[1]).toContain('DEFAULT_ALIAS_PATH="$NVM_ROOT/alias/default"');
    expect(setupCommands[1]).toContain('cp "$DEFAULT_ALIAS_PATH" "$DEFAULT_ALIAS_BACKUP"');
    expect(setupCommands[1]).toContain('trap restore_default EXIT');
    expect(setupCommands[1]).toContain('rm -f "$DEFAULT_ALIAS_PATH"');
  });

  it.each([
    { name: 'restores an existing default alias byte-for-byte', initialAlias: 'lts/hydrogen\n' },
    { name: 'removes the default alias when none existed', initialAlias: null },
  ])('$name', async ({ initialAlias }) => {
    vi.useRealTimers();
    const root = await mkdtemp(join(tmpdir(), 'overdeck-fake-nvm-'));
    const aliasPath = join(root, 'alias', 'default');
    try {
      await writeFile(join(root, 'nvm.sh'), [
        'nvm() {',
        '  if [ "$1" = "install" ]; then',
        '    mkdir -p "$NVM_ROOT/alias"',
        '    printf "24\\n" > "$NVM_ROOT/alias/default"',
        '  fi',
        '}',
        '',
      ].join('\n'));
      if (initialAlias !== null) {
        await mkdir(join(root, 'alias'), { recursive: true });
        await writeFile(aliasPath, initialAlias);
      }

      const plan = await resolveOpenKnowledgeSetupPlan({
        env: { NVM_DIR: root },
        homedir: () => '/home/tester',
        runCommand: vi.fn(async () => { throw new Error('missing'); }),
        resolveRuntime: vi.fn(async () => ({ kind: 'manager-without-24' as const, manager: 'nvm' as const })),
      });
      if (plan.kind !== 'install-node-via-manager') throw new Error('expected nvm manager plan');

      const nodePath = join(root, 'versions', 'node', 'v24.17.0', 'bin', 'node');
      const runCommand = vi.fn(async (command: string, args: string[]) => {
        if (command === 'bash') {
          await new Promise<void>((resolve, reject) => {
            execFile('bash', args, { env: { ...process.env, HOME: '/home/tester', NVM_DIR: root } }, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
        }
        return success();
      });

      await executeOpenKnowledgeSetupPlan(plan, {
        env: { PATH: '/usr/bin', NVM_DIR: root },
        homedir: () => '/home/tester',
        runCommand,
        resolveRuntime: vi.fn(async () => ({ kind: 'runtime' as const, nodePath, source: 'nvm' as const })),
        realpath: async () => join(root, 'bin', 'ok-target'),
        writeShim: async () => '/home/tester/.local/bin/ok',
      });

      if (initialAlias === null) {
        await expect(access(aliasPath)).rejects.toThrow();
      } else {
        expect(await readFile(aliasPath, 'utf8')).toBe(initialAlias);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('getOpenKnowledgeStatus', () => {
  it('runs status through the provided ok command', async () => {
    const runCommand = vi.fn(async () => success(JSON.stringify({
      server: { name: 'server', state: 'alive', alive: true, port: 8789 },
      ui: { name: 'ui', state: 'alive', alive: true, port: 39847 },
    })));

    const result = await getOpenKnowledgeStatus('/tmp/knowledge', runCommand, '/home/tester/.local/bin/ok');

    expect(result.server.alive).toBe(true);
    expect(runCommand).toHaveBeenCalledWith('/home/tester/.local/bin/ok', [
      '--cwd',
      '/tmp/knowledge',
      'status',
      '--json',
    ]);
  });
});

describe('startOpenKnowledgeServer', () => {
  const missingStatus = {
    server: { name: 'server', state: 'missing', alive: false },
    ui: { name: 'ui', state: 'missing', alive: false },
  };
  const liveStatus = {
    server: { name: 'server', state: 'alive', alive: true, port: 8789 },
    ui: { name: 'ui', state: 'alive', alive: true, port: 39847 },
  };

  it('initializes without MCP or skills and waits for the actual live ports', async () => {
    const runCommand = vi.fn(async () => success());
    const child = new EventEmitter() as ChildProcess;
    Object.defineProperty(child, 'exitCode', { value: null, writable: true });
    child.kill = vi.fn(() => true);
    const spawnProcess = vi.fn((_command, _args, _options) => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });
    const getStatus = vi.fn()
      .mockResolvedValueOnce(missingStatus)
      .mockResolvedValueOnce(liveStatus);

    const result = await startOpenKnowledgeServer('/tmp/knowledge', {
      runCommand,
      spawnProcess,
      getStatus,
      fetchImpl: vi.fn(async () => new Response('ok')),
      isInitialized: async () => false,
      getAvailablePorts: async () => [8789, 39847],
    });

    expect(runCommand).toHaveBeenCalledWith('ok', [
      '--cwd',
      '/tmp/knowledge',
      'init',
      '--no-mcp',
      '--no-skills',
      '--local-only',
      '--content-dir',
      '.',
      '--json',
    ]);
    expect(spawnProcess).toHaveBeenCalledWith('ok', [
      '--cwd',
      '/tmp/knowledge',
      'start',
      '--port',
      '8789',
      '--ui-port',
      '39847',
      '--host',
      '127.0.0.1',
      '--mode',
      'browser',
    ], { stdio: 'ignore' });
    expect(result).toEqual({
      process: child,
      owned: true,
      reused: false,
      port: 39847,
      apiPort: 8789,
      url: 'http://127.0.0.1:39847',
      runtimeBundlePath: '/tmp/knowledge',
    });
  });

  it('initializes and starts through the provided ok command', async () => {
    const okCommand = '/home/tester/.local/bin/ok';
    const runCommand = vi.fn(async () => success());
    const child = new EventEmitter() as ChildProcess;
    Object.defineProperty(child, 'exitCode', { value: null, writable: true });
    child.kill = vi.fn(() => true);
    const spawnProcess = vi.fn((_command, _args, _options) => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });
    const getStatus = vi.fn()
      .mockResolvedValueOnce(missingStatus)
      .mockResolvedValueOnce(liveStatus);

    await startOpenKnowledgeServer('/tmp/knowledge', {
      okCommand,
      runCommand,
      spawnProcess,
      getStatus,
      fetchImpl: vi.fn(async () => new Response('ok')),
      isInitialized: async () => false,
      getAvailablePorts: async () => [8789, 39847],
    });

    expect(runCommand).toHaveBeenCalledWith(okCommand, expect.arrayContaining(['init']));
    expect(spawnProcess).toHaveBeenCalledWith(okCommand, expect.arrayContaining(['start']), { stdio: 'ignore' });
  });

  it('reuses a healthy lock-reported viewer and returns its verified URL', async () => {
    const spawnProcess = vi.fn();

    const result = await startOpenKnowledgeServer('/tmp/knowledge', {
      getStatus: async () => liveStatus,
      fetchImpl: vi.fn(async () => new Response('ok')),
      spawnProcess,
    });

    expect(spawnProcess).not.toHaveBeenCalled();
    expect(result).toEqual({
      process: null,
      owned: false,
      reused: true,
      port: 39847,
      apiPort: 8789,
      url: 'http://127.0.0.1:39847',
      runtimeBundlePath: '/tmp/knowledge',
    });
  });

  it('adds --open only for an explicit browser-opening request', async () => {
    const child = new EventEmitter() as ChildProcess;
    Object.defineProperty(child, 'exitCode', { value: null, writable: true });
    child.kill = vi.fn(() => true);
    const spawnProcess = vi.fn((_command, _args, _options) => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });
    const getStatus = vi.fn()
      .mockResolvedValueOnce(missingStatus)
      .mockResolvedValueOnce(liveStatus);

    await startOpenKnowledgeServer('/tmp/knowledge', {
      apiPort: 8789,
      uiPort: 39847,
      openBrowser: true,
      spawnProcess,
      getStatus,
      fetchImpl: vi.fn(async () => new Response('ok')),
      isInitialized: async () => true,
    });

    expect(spawnProcess.mock.calls[0]?.[1]).toContain('--open');
    expect(spawnProcess.mock.calls[0]?.[1]).not.toContain('--no-open');
  });
});

describe('prepareOpenKnowledgeSnapshot', () => {
  it('creates a disposable projection that cannot mutate the canonical bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-knowledge-snapshot-'));
    const source = join(root, 'source');
    const snapshots = join(root, 'snapshots');
    await mkdir(join(source, '.git'), { recursive: true });
    await mkdir(join(source, '.ok'), { recursive: true });
    await writeFile(join(source, 'concept.md'), 'canonical\n');
    await writeFile(join(source, '.git', 'config'), 'git metadata\n');
    await writeFile(join(source, '.ok', 'config.yml'), 'runtime metadata\n');

    try {
      const snapshot = await prepareOpenKnowledgeSnapshot(source, snapshots);
      await writeFile(join(snapshot, 'concept.md'), 'viewer edit\n');

      expect(await readFile(join(source, 'concept.md'), 'utf8')).toBe('canonical\n');
      expect(await readFile(join(snapshot, 'concept.md'), 'utf8')).toBe('viewer edit\n');
      await expect(access(join(snapshot, '.git', 'HEAD'))).resolves.toBeUndefined();
      await expect(access(join(snapshot, '.ok'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
