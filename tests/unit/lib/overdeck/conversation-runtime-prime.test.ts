import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/lib/agents/agent-state.js', () => ({
  getAgentDir: (agentId: string) => `/tmp/${agentId}`,
  getAgentStateSync: vi.fn(),
}));
vi.mock('../../../../src/lib/openai-auth.js', async () => {
  const { Effect } = await import('effect');
  return { getOpenAIAuthStatus: () => Effect.succeed({ loggedIn: false }) };
});
vi.mock('../../../../src/lib/config-yaml.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/lib/config-yaml.js')>(),
  loadConfigSync: () => ({ config: { providerAuth: { openai: 'api-key' }, primeAgent: { rpcStartupTimeoutMs: 45_000 } }, path: '/tmp/config.yaml' }),
}));

const { preparePrimeAgentConversationLaunch, resolveAllowedHarness } = await import(
  '../../../../src/lib/overdeck/conversation-runtime.js'
);

describe('Prime Agent conversation launch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts an explicit Prime harness selection', async () => {
    await expect(resolveAllowedHarness('prime-agent', 'gpt-5.4')).resolves.toBe('prime-agent');
  });

  it('assembles a persistent managed RPC launch', async () => {
    const launch = await preparePrimeAgentConversationLaunch('conv-prime', '/workspaces/project', 'gpt-5.4');
    expect(launch.fields).toEqual({ harness: 'prime-agent' });
    expect(launch.runtimeCommand).toContain("prime-agent-host.js' --agent 'conv-prime'");
    expect(launch.runtimeCommand).toContain("--provider 'openai' --model 'gpt-5.4'");
    expect(launch.runtimeCommand).toContain("--session-dir '/tmp/conv-prime/prime-sessions'");
    expect(launch.runtimeCommand).toContain('--append-system-prompt');
    expect(launch.runtimeCommand).toContain('--startup-timeout-ms 45000');
    expect(launch.runtimeCommand).not.toContain('--permission-mode');
  });
});
