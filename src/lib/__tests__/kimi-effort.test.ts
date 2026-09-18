import { describe, expect, it } from 'vitest';
import { resolveKimiNativeEffort } from '../kimi-effort.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { getClaudeCodeContextPolicyForModel } from '../agents/provider-env.js';

describe('managed Kimi effort', () => {
  it.each([
    ['k3', 262144], ['k3[1m]', 1048576], ['kimi-k2.7-code', 262144],
    ['glm-5.2', 1000000],
  ] as const)('pins both Claude context settings for %s', (model, contextWindow) => {
    expect(getClaudeCodeContextPolicyForModel(model)).toEqual({
      autoCompactWindow: contextWindow,
      maxContextTokens: contextWindow,
    });
  });
  it.each(['k3', 'k3-256k', 'k3[1m]', 'kimi-code/k3', 'kimi-code/k3-256k'])(
    'defaults %s to high instead of the CLI model default', (model) => {
      expect(resolveKimiNativeEffort(model)).toBe('high');
    },
  );

  it.each([['low', 'low'], ['medium', 'high'], ['high', 'high'], ['xhigh', 'max'], ['max', 'max']])(
    'preserves the meaning of saved %s effort', (requested, expected) => {
      expect(resolveKimiNativeEffort('k3', requested)).toBe(expected);
    },
  );

  it('rejects an unknown K3 effort rather than silently using the CLI default', () => {
    expect(() => resolveKimiNativeEffort('k3', 'invalid')).toThrow('Invalid Kimi K3 effort');
  });

  it.each(['kimi-k2.7-code', 'kimi-for-coding', 'kimi-code/kimi-for-coding', 'kimi-code/kimi-for-coding-highspeed'])(
    'exposes no adjustable effort for %s', (model) => {
      expect(resolveKimiNativeEffort(model, 'high')).toBeUndefined();
    },
  );

  it.each(['low', 'high', 'max'])(
    'exports explicit %s effort for fresh and resumed native launches', (effort) => {
      for (const resumeSessionId of [undefined, 'existing-session']) {
        const script = generateLauncherScriptSync({
          role: 'work', workingDir: '/workspace', harness: 'kimi-code',
          kimiCodeModel: 'kimi-code/k3', kimiCodeEffort: effort, resumeSessionId,
        });
        expect(script).toContain(`export KIMI_MODEL_THINKING_EFFORT='${effort}'`);
        expect(script.indexOf('export KIMI_MODEL_THINKING_EFFORT')).toBeLessThan(script.indexOf("kimi -m 'kimi-code/k3'"));
        expect(script).not.toContain('--effort');
      }
    },
  );

  it('clears an inherited forced effort for K2.7 instead of claiming it supports levels', () => {
    const script = generateLauncherScriptSync({
      role: 'work', workingDir: '/workspace', harness: 'kimi-code',
      kimiCodeModel: 'kimi-code/kimi-for-coding', kimiCodeEffort: 'high',
    });
    expect(script).toContain('unset KIMI_MODEL_THINKING_EFFORT');
    expect(script).not.toContain('export KIMI_MODEL_THINKING_EFFORT');
  });

  it('passes explicit effort into the persistent ACP host', () => {
    const script = generateLauncherScriptSync({
      role: 'work', workingDir: '/workspace', harness: 'acp',
      acpAgentId: 'agent-test', acpProvider: 'kimi', acpWorkspace: '/workspace',
      acpBinaryPath: '/bin/kimi', model: 'kimi-code/k3', acpEffort: 'low',
    });
    expect(script).toContain("--effort 'low'");
  });
});
