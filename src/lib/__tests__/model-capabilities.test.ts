import { describe, expect, it } from 'vitest';

import { CLIPROXY_CODEX_CONTEXT_WINDOW, CLIPROXY_GPT56_CONTEXT_WINDOW, MODEL_CAPABILITIES } from '../model-capabilities.js';

describe('model capabilities', () => {
  it('locks gpt-5.5 contextWindow to the CLIProxy Codex ceiling', () => {
    const gpt55 = MODEL_CAPABILITIES['gpt-5.5'];
    expect(gpt55).toBeDefined();
    expect(gpt55.contextWindow).toBe(CLIPROXY_CODEX_CONTEXT_WINDOW);
    expect(gpt55.contextWindow).toBe(150_000);
  });

  it('documents the effective CLIProxy ceiling consistently in gpt-5.5 notes', () => {
    const gpt55 = MODEL_CAPABILITIES['gpt-5.5'];
    expect(gpt55.notes).toContain('150K');
    expect(gpt55.notes).not.toContain('200K');
  });

  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const)(
    'locks %s contextWindow to the GPT-5.6 CLIProxy ceiling',
    (model) => {
      const capability = MODEL_CAPABILITIES[model];
      expect(capability).toBeDefined();
      expect(capability.contextWindow).toBe(CLIPROXY_GPT56_CONTEXT_WINDOW);
      expect(capability.contextWindow).toBe(372_000);
    },
  );

  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const)(
    'documents the effective CLIProxy ceiling consistently in %s notes',
    (model) => {
      expect(MODEL_CAPABILITIES[model].notes).toContain('372K');
      expect(MODEL_CAPABILITIES[model].notes).not.toContain('150K');
    },
  );

  // PAN-3057: the harness pin and the capability table are one number. If these
  // drift again, the dashboard meter and the Deacon's proactive compaction score
  // GPT-5.6 agents against a window the harness was never given.
  it('feeds the same GPT-5.6 window to the harness env exports and the capability table', async () => {
    const { getClaudeCodeContextPolicyForModel } = await import('../agents/provider-env.js');
    const policy = getClaudeCodeContextPolicyForModel('gpt-5.6-sol');

    expect(policy.maxContextTokens).toBe(MODEL_CAPABILITIES['gpt-5.6-sol'].contextWindow);
    expect(policy.autoCompactWindow).toBe(MODEL_CAPABILITIES['gpt-5.6-sol'].contextWindow);
  });
});
