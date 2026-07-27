import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  commands: [] as string[],
  launcherOptions: undefined as Record<string, unknown> | undefined,
  remoteFiles: new Map<string, string>(),
}));

vi.mock('../../../src/lib/remote/fly-provider.js', () => ({
  createFlyProvider: () => ({
    getStatus: () => Effect.succeed('running'),
    ssh: () => Effect.succeed({ stdout: '', stderr: '', exitCode: 0 }),
  }),
}));

vi.mock('../../../src/lib/pan-dir/record.js', () => ({
  resolveProjectForIssue: () => null,
}));

vi.mock('../../../src/lib/launcher-generator.js', () => ({
  generateLauncherScriptSync: (options: Record<string, unknown>) => {
    mocks.launcherOptions = options;
    return '#!/bin/sh\nexec claude\n';
  },
}));

vi.mock('../../../src/lib/remote/remote-tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/remote/remote-tmux.js')>();
  const chunks = new Map<string, string>();
  return {
    ...actual,
    ensureRemoteTmuxContext: () => Promise.resolve(),
    runSsh: async (_provider: unknown, _vm: string, command: string) => {
      mocks.commands.push(command);
      if (command.includes('has-session')) {
        return { stdout: 'not-found\n', stderr: '', exitCode: 0 };
      }
      const append = command.match(/printf %s '([^']*)' >> (\S+)/);
      if (append) {
        chunks.set(append[2], `${chunks.get(append[2]) ?? ''}${append[1]}`);
      }
      const decode = command.match(/base64 -d < (\S+) > (\S+)/);
      if (decode) {
        const content = Buffer.from(chunks.get(decode[1]) ?? '', 'base64').toString('utf8');
        mocks.remoteFiles.set(decode[2], content);
        return { stdout: `${Buffer.byteLength(content)}\n`, stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  };
});

describe('remote agent provenance', () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    mocks.commands.length = 0;
    mocks.launcherOptions = undefined;
    mocks.remoteFiles.clear();
    home = mkdtempSync(join(tmpdir(), 'remote-agent-provenance-'));
    previousHome = process.env.HOME;
    process.env.HOME = home;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('persists and exports the accepted immediate origin', async () => {
    const { spawnRemoteAgent } = await import('../../../src/lib/remote/remote-agents.js');
    const state = await spawnRemoteAgent({
      issueId: 'PAN-3111',
      workspace: {
        id: 'remote-pan-3111',
        issue: 'PAN-3111',
        provider: 'fly',
        vmName: 'pan-3111-vm',
        urls: {},
        created: new Date('2026-07-26T00:00:00.000Z'),
        location: 'remote',
      },
      prompt: 'implement the issue',
      model: 'claude-sonnet-4-6',
      startedBy: 'flywheel:RUN-42',
      tier: 'ephemeral',
    });

    expect(state.startedBy).toBe('flywheel:RUN-42');
    expect(mocks.launcherOptions?.extraEnvExports).toEqual([
      "export OVERDECK_AGENT_STARTED_BY='flywheel:RUN-42'",
    ]);
    const persisted = JSON.parse(readFileSync(
      join(home, '.overdeck', 'agents', state.id, 'remote-state.json'),
      'utf8',
    ));
    expect(persisted.startedBy).toBe('flywheel:RUN-42');
  });

  it('lets an explicit operator remote start proceed when planning consent is unreadable', async () => {
    const consentDir = join(home, '.overdeck', 'agents', 'planning-pan-3112');
    mkdirSync(consentDir, { recursive: true });
    writeFileSync(join(consentDir, 'auto-spawn-on-finalize.json'), '{invalid-json');
    const { spawnRemoteAgent } = await import('../../../src/lib/remote/remote-agents.js');

    await expect(spawnRemoteAgent({
      issueId: 'PAN-3112',
      workspace: {
        id: 'remote-pan-3112',
        issue: 'PAN-3112',
        provider: 'fly',
        vmName: 'pan-3112-vm',
        urls: {},
        created: new Date('2026-07-26T00:00:00.000Z'),
        location: 'remote',
      },
      model: 'claude-sonnet-4-6',
      startedBy: 'operator:dashboard',
      tier: 'ephemeral',
    })).resolves.toMatchObject({ status: 'running' });
  });

  it('exports provenance in the direct remote command without a prompt', async () => {
    const { spawnRemoteAgent } = await import('../../../src/lib/remote/remote-agents.js');
    await spawnRemoteAgent({
      issueId: 'PAN-3112',
      workspace: {
        id: 'remote-pan-3112',
        issue: 'PAN-3112',
        provider: 'fly',
        vmName: 'pan-3112-vm',
        urls: {},
        created: new Date('2026-07-26T00:00:00.000Z'),
        location: 'remote',
      },
      model: 'claude-sonnet-4-6',
      startedBy: 'operator:dashboard',
      tier: 'ephemeral',
    });

    const launch = mocks.commands.find(command =>
      command.includes('new-session') && command.includes('agent-pan-3112'),
    );
    expect(launch).toContain('OVERDECK_AGENT_STARTED_BY=');
    expect(launch).toContain('operator:dashboard');
    expect(launch).toContain('claude --permission-mode');
  });
});
