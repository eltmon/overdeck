import { describe, expect, it } from 'vitest';

import {
  buildAgentLaunchConfig,
  determineModel,
  getAgentRuntimeBaseCommand,
  getRoleRuntimeBaseCommand,
  restartAgent,
  resumeAgent,
  spawnRun,
} from '../agents.js';
import { normalizeModelOverrideSync, requireModelOverrideSync, shellQuoteModelIdSync } from '../model-validation.js';

const MALICIOUS_MODEL = 'claude-sonnet-4-6; touch /tmp/pan-model-pwned #';

function expectModelRejection(fn: () => unknown | Promise<unknown>) {
  return expect(fn()).rejects.toThrow(/model must match/);
}

describe('model override validation', () => {
  it('normalizes safe provider model identifiers and rejects shell metacharacters', () => {
    expect(normalizeModelOverrideSync(' qwen/qwen3.6-plus:free ')).toBe('qwen/qwen3.6-plus:free');
    expect(normalizeModelOverrideSync(' oai@gpt-5.5 ')).toBe('oai@gpt-5.5');
    expect(normalizeModelOverrideSync('')).toBeUndefined();
    expect(() => normalizeModelOverrideSync(MALICIOUS_MODEL)).toThrow(/model must match/);
    expect(() => normalizeModelOverrideSync('claude-sonnet-4-6 && whoami')).toThrow(/model must match/);
    expect(() => normalizeModelOverrideSync('claude-sonnet-4-6\nwhoami')).toThrow(/model must match/);
  });

  it('quotes validated model ids before launcher command interpolation', () => {
    expect(requireModelOverrideSync('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(shellQuoteModelIdSync('qwen/qwen3.6-plus:free')).toBe("'qwen/qwen3.6-plus:free'");
  });

  it('rejects malicious model overrides in agent model resolution', () => {
    expect(() => determineModel({ role: 'work', model: MALICIOUS_MODEL })).toThrow(/model must match/);
  });

  it('rejects malicious model overrides in runtime command builders', async () => {
    await expectModelRejection(() => getAgentRuntimeBaseCommand(MALICIOUS_MODEL));
    await expectModelRejection(() => getRoleRuntimeBaseCommand(MALICIOUS_MODEL, 'agent-pan-1140-review', 'review'));
  });

  it('emits shell-quoted model arguments in runtime command builders', async () => {
    await expect(getAgentRuntimeBaseCommand('claude-sonnet-4-6')).resolves.toContain("--model 'claude-sonnet-4-6'");
    await expect(getRoleRuntimeBaseCommand('claude-opus-4-7', 'agent-pan-1140-review', 'review')).resolves.toContain("--model 'claude-opus-4-7'");
  });

  it('rejects malicious model overrides before launch config generation', async () => {
    await expectModelRejection(() => buildAgentLaunchConfig({
      agentId: 'agent-pan-1140',
      model: MALICIOUS_MODEL,
      workspace: '/tmp/pan-workspace',
      role: 'work',
    }));
  });

  it('rejects malicious model overrides in resume and restart requests', async () => {
    await expectModelRejection(() => resumeAgent('agent-pan-1140', undefined, { model: MALICIOUS_MODEL }));
    await expectModelRejection(() => restartAgent('agent-pan-1140', { model: MALICIOUS_MODEL }));
  });

  it('rejects malicious model overrides in spawnRun before role-run side effects', async () => {
    await expectModelRejection(() => spawnRun('PAN-1140', 'review', {
      workspace: '/tmp/pan-workspace',
      model: MALICIOUS_MODEL,
    }));
  });
});
