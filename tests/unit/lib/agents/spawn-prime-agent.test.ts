import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/lib/agents/agent-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/agents/agent-state.js')>();
  return { ...actual, getAgentDir: (id: string) => join(tmpdir(), id) };
});

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentStateSync: () => null,
  listAgentStates: () => [],
}));

vi.mock('../../../../src/lib/config-yaml.js', () => ({ loadConfigSync: () => ({ config: { providerAuth: { openai: 'api-key' }, primeAgent: { rpcStartupTimeoutMs: 45_000 } } }) }));
vi.mock('../../../../src/lib/openai-auth.js', async () => {
  const { Effect } = await import('effect');
  return { getOpenAIAuthStatus: () => Effect.succeed({ loggedIn: false }) };
});

import { getPrimeAgentBaseCommand } from '../../../../src/lib/agents/runtime-command.js';
import { generateLauncherScriptSync } from '../../../../src/lib/launcher-generator.js';

describe('Prime Agent work launch', () => {
  it('assembles explicit RPC provider, model, session directory, and managed policy arguments', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'prime-workspace-'));
    const baseCommand = await getPrimeAgentBaseCommand('agent-pan-3668', 'gpt-5.4', workspace);
    expect(baseCommand).toContain("prime-agent-host.js' --agent 'agent-pan-3668'");
    expect(baseCommand).toContain("--provider 'openai' --model 'gpt-5.4'");
    expect(baseCommand).toContain("--session-dir '/tmp/agent-pan-3668/prime-sessions'");
    expect(baseCommand).toContain('--append-system-prompt');
    expect(baseCommand).toContain('--startup-timeout-ms 45000');

    const launcher = generateLauncherScriptSync({ role: 'work', workingDir: workspace, harness: 'prime-agent', baseCommand });
    expect(launcher).toContain('exec node');
    expect(launcher).toContain('prime-agent-host.js');
    expect(launcher).not.toContain('exec claude');
  });

  it('surfaces unsupported mapping without falling back to Claude Code', async () => {
    await expect(getPrimeAgentBaseCommand('agent-pan-3668', 'ql-swift-8b', '/workspace')).rejects.toThrow('no fallback model was selected');
  });
});
