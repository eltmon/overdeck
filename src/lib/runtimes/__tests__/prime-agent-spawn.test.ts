/**
 * PAN-3668 WI-15 (prime-runtime-adapter.ac4): the Cloister runtime launches Prime
 * through the terminal-backend launch door and never through tmux directly.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmuxCli = vi.hoisted(() => ({ tmuxCreateSession: vi.fn(), tmuxKillSession: vi.fn(), tmuxSessionExists: vi.fn(async () => false) }));
vi.mock('../tmux-cli.js', () => tmuxCli);
vi.mock('../../harness-binary.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../harness-binary.js')>()),
  prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/opt/prime/bin/prime-agent', pathExport: 'export PATH="/opt/prime/bin:$PATH"' })),
}));
vi.mock('../../prime-agent/launcher-fields.js', () => ({
  getPrimeAgentLauncherFields: vi.fn(async (agentId: string, model: string, workspace: string, binaryPath: string) => ({
    fields: {
      harness: 'prime-agent',
      primeAgent: { agentId, binaryPath, provider: 'openai', workspace, contextFile: '/tmp/ctx.md' },
      model,
      unsetProviderEnv: true,
      preserveProviderEnv: ['OPENAI_API_KEY'],
    },
    paneEnv: { OPENAI_API_KEY: 'sk-runtime-test' },
  })),
}));
vi.mock('../../agents/runtime-command.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agents/runtime-command.js')>()),
  getProviderAuthMode: vi.fn(async () => 'api-key'),
}));

import { registerRuntimeLivenessProbe } from '../runtime-liveness.js';
import { PrimeAgentRuntimeSync } from '../prime-agent.js';

describe('PrimeAgentRuntimeSync.spawnAgent (PAN-3668 WI-15)', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-prime-rt-spawn-'));
    registerRuntimeLivenessProbe(async () => false);
  });

  afterEach(() => {
    registerRuntimeLivenessProbe(null);
    rmSync(home, { recursive: true, force: true });
  });

  it('launches through launchRuntimePane with the credential in the pane env, waits for the host, and delivers the prompt', async () => {
    const agentId = 'agent-pan-7';
    const order: string[] = [];
    const launchPane = vi.fn(async (input: { env?: Record<string, string>; harness: string; launcherScript: string }) => {
      order.push('launch');
      mkdirSync(join(home, 'agents', agentId), { recursive: true });
      writeFileSync(join(home, 'agents', agentId, 'prime-agent-session-id'), 'sid-7\n');
      return { backend: 'herdr', workspaceId: 'w', paneId: 'p', terminalId: 't', agentName: agentId } as never;
    });
    const waitReady = vi.fn(async () => { order.push('ready'); });
    const deliver = vi.fn(async () => { order.push('deliver'); return { ok: true, path: 'prime-agent' } as never; });
    const runtime = new PrimeAgentRuntimeSync({
      home: () => home,
      resolveBackend: async () => ({ name: 'herdr' }) as never,
      launchPane: launchPane as never,
      waitReady,
      deliver: deliver as never,
    });

    const agent = await runtime.spawnAgent({ agentId, workspace: join(home, 'ws'), model: 'gpt-5.4', prompt: 'hello prime' });

    expect(agent).toMatchObject({ id: agentId, sessionId: 'sid-7', runtime: 'prime-agent', model: 'gpt-5.4' });
    expect(launchPane.mock.calls[0]![0]).toMatchObject({ harness: 'prime-agent', env: { OPENAI_API_KEY: 'sk-runtime-test' } });
    expect(order).toEqual(['launch', 'ready', 'deliver']);
    expect(deliver).toHaveBeenCalledWith(agentId, 'hello prime', 'prime-agent-runtime');
    expect(tmuxCli.tmuxCreateSession).not.toHaveBeenCalled();
  });
});
