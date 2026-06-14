import { describe, expect, it } from 'vitest';

import { CLIPROXY_CODEX_CONTEXT_WINDOW, MODEL_CAPABILITIES } from '../model-capabilities.js';

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
});
