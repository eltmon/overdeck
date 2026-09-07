import { describe, expect, it } from 'vitest';

import { CLIPROXY_CODEX_CONTEXT_WINDOW, CLIPROXY_GPT56_CONTEXT_WINDOW, CLIPROXY_GPT56_LONG_CONTEXT_WINDOW, MODEL_CAPABILITIES } from '../model-capabilities.js';

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

  // PAN-3388: bare ids pin to the 272K billing tier (>272K input bills 2x/1.5x
  // for the full request); [372k] variants opt into the long window.
  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const)(
    'locks %s contextWindow to the GPT-5.6 billing-tier ceiling',
    (model) => {
      const capability = MODEL_CAPABILITIES[model];
      expect(capability).toBeDefined();
      expect(capability.contextWindow).toBe(CLIPROXY_GPT56_CONTEXT_WINDOW);
      expect(capability.contextWindow).toBe(272_000);
    },
  );

  it.each(['gpt-5.6-sol[372k]', 'gpt-5.6-terra[372k]', 'gpt-5.6-luna[372k]'] as const)(
    'locks %s contextWindow to the long-context ceiling',
    (model) => {
      const capability = MODEL_CAPABILITIES[model];
      expect(capability).toBeDefined();
      expect(capability.contextWindow).toBe(CLIPROXY_GPT56_LONG_CONTEXT_WINDOW);
      expect(capability.contextWindow).toBe(372_000);
    },
  );

  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const)(
    'documents the billing tier consistently in %s notes',
    (model) => {
      expect(MODEL_CAPABILITIES[model].notes).toContain('272K');
      expect(MODEL_CAPABILITIES[model].notes).not.toContain('150K');
    },
  );

  // PAN-3057: the harness pin and the capability table are one number. If these
  // drift again, the dashboard meter and the Deacon's proactive compaction score
  // GPT-5.6 agents against a window the harness was never given.
  it.each(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-sol[372k]'] as const)(
    'feeds the same window to the harness env exports and the capability table for %s',
    async (model) => {
      const { getClaudeCodeContextPolicyForModel } = await import('../agents/provider-env.js');
      const policy = getClaudeCodeContextPolicyForModel(model);

      expect(policy.maxContextTokens).toBe(MODEL_CAPABILITIES[model].contextWindow);
      expect(policy.autoCompactWindow).toBe(MODEL_CAPABILITIES[model].contextWindow);
    },
  );

  // PAN-3388: the [372k] suffix is Overdeck-side only — the launch door must
  // hand every harness CLI the base API id.
  it('strips the [372k] suffix at the shell-quote launch door', async () => {
    const { shellQuoteModelIdSync } = await import('../model-validation.js');
    expect(shellQuoteModelIdSync('gpt-5.6-sol[372k]')).toBe("'gpt-5.6-sol'");
    expect(shellQuoteModelIdSync('gpt-5.6-terra[372k]')).toBe("'gpt-5.6-terra'");
    expect(shellQuoteModelIdSync('gpt-5.6-luna[372k]')).toBe("'gpt-5.6-luna'");
    // Kimi's [1m] suffix is a real endpoint alias and must pass through.
    expect(shellQuoteModelIdSync('k3[1m]')).toBe("'k3[1m]'");
  });

  // gpt-6-astra: added from the live Codex catalog (`codex debug models`,
  // 2026-09-07 — context_window 272000, max_context_window 872000,
  // supported_in_api true) with pricing from
  // developers.openai.com/api/docs/models/gpt-6-astra ($10 in / $50 out /
  // $1 cached). It shares the GPT-5.6 family's 272K billing tier, so it must
  // resolve to the openai provider and carry the same context pin.
  it('registers gpt-6-astra against the openai provider with the 272K billing-tier pin', async () => {
    const { getProviderForModelSync } = await import('../providers.js');
    const { getPricingSync } = await import('../cost.js');
    const { CLIPROXY_GPT56_CONTEXT_WINDOW } = await import('../model-context-windows.js');

    expect(getProviderForModelSync('gpt-6-astra').name).toBe('openai');

    const capability = MODEL_CAPABILITIES['gpt-6-astra'];
    expect(capability.displayName).toBe('GPT-6 Astra');
    expect(capability.contextWindow).toBe(CLIPROXY_GPT56_CONTEXT_WINDOW);

    const pricing = getPricingSync('openai', 'gpt-6-astra')!;
    expect(pricing.inputPer1k).toBe(0.01);
    expect(pricing.outputPer1k).toBe(0.05);
    expect(pricing.cacheReadPer1k).toBe(0.001);
  });

  // No [372k] opt-in variant ships for astra: the 372K pin was measured on
  // gpt-5.6-sol only. Guard against someone adding the id without measuring.
  it('does not surface a gpt-6-astra[372k] variant', async () => {
    const { GPT56_LONG_CONTEXT_VARIANTS } = await import('../model-context-windows.js');
    expect(Object.keys(GPT56_LONG_CONTEXT_VARIANTS)).not.toContain('gpt-6-astra[372k]');
    expect(MODEL_CAPABILITIES['gpt-6-astra[372k]']).toBeUndefined();
  });

  it('exposes QuantumLlama capabilities with spec display names and windows (PAN-3252)', () => {
    const nano = MODEL_CAPABILITIES['ql-nano-1b'];
    expect(nano.displayName).toBe('QL Nano 1B');
    expect(nano.contextWindow).toBe(32000);
    expect(nano.maxOutputTokens).toBe(4096);

    const reason = MODEL_CAPABILITIES['ql-reason-70b'];
    expect(reason.displayName).toBe('QL Reason 70B');
    expect(reason.contextWindow).toBe(200000);
    expect(reason.maxOutputTokens).toBe(16384);

    const swift = MODEL_CAPABILITIES['ql-swift-8b'];
    expect(swift.displayName).toBe('QL Swift 8B');
    expect(swift.contextWindow).toBe(128000);
    expect(swift.maxOutputTokens).toBe(8192);
  });
});
