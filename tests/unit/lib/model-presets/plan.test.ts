/**
 * PAN-4400 WI-2: the preset plan engine diffs a preset against config.yaml
 * text, gates on credentials and harness policy, and never writes. Deps are
 * stubbed, so no real claude/codex process runs.
 */
import { describe, expect, it } from 'vitest';

import { PRESET_SETTINGS, getPreset } from '../../../../src/lib/model-presets/presets.js';
import {
  UnknownPresetError,
  planPresetApply,
  planPresetApplyFromText,
  type PresetPlan,
  type PresetPlanDeps,
} from '../../../../src/lib/model-presets/plan.js';
import type { AuthMode } from '../../../../src/lib/subscription-types.js';

/** `null` means the provider has no credentials (a default parameter would swallow `undefined`). */
function deps(authMode: AuthMode | null = 'subscription', configText = ''): PresetPlanDeps {
  return {
    readConfigText: async () => configText,
    hasCredentials: async () => authMode !== null,
    resolveHarnessBinary: async (harness) => `/usr/bin/${harness}`,
    getAuthMode: async () => authMode ?? undefined,
    resolveCodexContext: async () => ({}),
  };
}

async function plan(presetId: string, yaml: string, authMode: AuthMode | null = 'subscription'): Promise<PresetPlan> {
  return planPresetApplyFromText(getPreset(presetId)!, yaml, deps(authMode));
}

function rowFor(result: PresetPlan, path: string) {
  const found = result.rows.find((r) => r.path === path);
  if (!found) throw new Error(`no row for ${path}`);
  return found;
}

describe('planPresetApply', () => {
  it('plans every registry row for an empty config', async () => {
    const result = await planPresetApply('anthropic', deps('subscription', ''));
    const preset = getPreset('anthropic')!;
    expect(result.blocked).toBeUndefined();
    for (const entry of PRESET_SETTINGS) {
      const key = entry.path.join('.');
      const r = rowFor(result, key);
      expect(r.before).toEqual({ absent: true });
      if ('keep' in preset.values[key]!) {
        expect(r.status, key).toBe('skipped');
        expect(r.reason, key).toBeTruthy();
      } else {
        expect(r.status, key).toBe('change');
      }
    }
    // An absent anthropic provider node is already enabled.
    expect(rowFor(result, 'models.providers.anthropic').status).toBe('same');
    expect(result.notes).toContain('tiered execution has no tiers; nothing to set');
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('marks equal values as same', async () => {
    const result = await plan('anthropic', 'workhorses:\n  mid: claude-opus-5-5\nroles:\n  work:\n    model: workhorse:mid\n    effort: high\n');
    expect(rowFor(result, 'workhorses.mid').status).toBe('same');
    expect(rowFor(result, 'roles.work.model').status).toBe('same');
    expect(rowFor(result, 'roles.work.effort').status).toBe('same');
    expect(rowFor(result, 'workhorses.expensive').status).toBe('change');
  });

  it('blocks when the provider has no credentials', async () => {
    const result = await plan('openai', '', null);
    expect(result.blocked?.reason).toMatch(/codex login/);
    expect(result.rows.some((r) => r.status === 'change')).toBe(false);
    expect(rowFor(result, 'workhorses.mid').reason).toBe(result.blocked!.reason);

    const anthropic = await plan('anthropic', '', null);
    expect(anthropic.blocked?.reason).toMatch(/Sign in \(claude\)/);
  });

  it('does not ask for an auth mode when the provider has no credentials', async () => {
    let asked = false;
    const result = await planPresetApplyFromText(getPreset('openai')!, '', {
      ...deps('api-key'),
      hasCredentials: async () => false,
      getAuthMode: async () => { asked = true; return 'api-key'; },
    });
    expect(result.blocked?.reason).toMatch(/^OpenAI has no credentials/);
    expect(asked).toBe(false);
    expect(result.rows.some((r) => r.status === 'change')).toBe(false);
  });

  it('blocks when the preset harness CLI is not installed', async () => {
    const result = await planPresetApplyFromText(getPreset('openai')!, '', {
      ...deps('subscription'),
      resolveHarnessBinary: async () => null,
    });
    expect(result.blocked?.reason).toMatch(/codex harness CLI is not installed.*npm install -g @openai\/codex/);
    expect(result.rows.some((r) => r.status === 'change')).toBe(false);
  });

  it('skips a role whose explicit harness the policy denies', async () => {
    const result = await plan('openai', 'roles:\n  work:\n    model: kimi-k2\n    harness: kimi-code\n');
    const work = rowFor(result, 'roles.work.model');
    expect(work.status).toBe('skipped');
    expect(work.reason).toBeTruthy();
    expect(rowFor(result, 'roles.work.effort').status).toBe('skipped');
    expect(rowFor(result, 'roles.test.model').status).toBe('change');
    expect(result.blocked).toBeUndefined();
  });

  it('blocks the plan when the policy denies a workhorse row', async () => {
    const preset = getPreset('openai')!;
    const denying: PresetPlanDeps = {
      ...deps('subscription'),
      resolveCodexContext: async () => ({ codexCliVersion: '0.1.0' }),
    };
    const result = await planPresetApplyFromText(preset, '', denying);
    expect(result.blocked?.reason).toMatch(/^Workhorse: /);
    expect(result.rows.some((r) => r.status === 'change')).toBe(false);
  });

  it('computes tier rows from difficulties and removes distributions', async () => {
    const yaml = [
      'tiered_execution:',
      '  enabled: true',
      '  tiers:',
      '    cheap-tier:',
      '      model: claude-haiku-4-5',
      '      harness: claude-code',
      '      difficulties: [trivial]',
      '    hard:',
      '      model: claude-opus-5-5',
      '      difficulties: [simple, complex]',
      '      distribution:',
      '        - { model: claude-opus-5-5, weight: 50 }',
      '        - { model: claude-sonnet-5-5, weight: 50 }',
      '  supervisor:',
      '    model: claude-opus-5',
      '    harness: claude-code',
      '',
    ].join('\n');
    const result = await plan('openai', yaml);
    expect(rowFor(result, 'tiered_execution.tiers.hard.model').after).toBe('workhorse:expensive');
    expect(rowFor(result, 'tiered_execution.tiers.hard.harness').after).toBe('codex');
    expect(rowFor(result, 'tiered_execution.tiers.hard.effort').after).toBe('high');
    const distribution = rowFor(result, 'tiered_execution.tiers.hard.distribution');
    expect(distribution.after).toEqual({ removed: true });
    expect(distribution.before).toEqual([
      { model: 'claude-opus-5-5', weight: 50 },
      { model: 'claude-sonnet-5-5', weight: 50 },
    ]);
    expect(distribution.status).toBe('change');
    expect(rowFor(result, 'tiered_execution.tiers.cheap-tier.model').after).toBe('workhorse:cheap');
    expect(rowFor(result, 'tiered_execution.supervisor.model').after).toBe('workhorse:expensive');
    expect(rowFor(result, 'tiered_execution.supervisor.harness').after).toBe('codex');
    expect(result.rows.some((r) => r.path === 'tiered_execution.enabled')).toBe(false);
    expect(result.notes).toEqual([]);

    // The Anthropic cheap band sets no effort (Haiku 4.5 has no effort control).
    const anthropic = await plan('anthropic', yaml);
    expect(anthropic.rows.some((r) => r.path === 'tiered_execution.tiers.cheap-tier.effort')).toBe(false);
    expect(rowFor(anthropic, 'tiered_execution.tiers.cheap-tier.model').status).toBe('change');
  });

  it('treats a boolean provider node as a whole-node change', async () => {
    const result = await plan('openai', 'models:\n  providers:\n    openai: false\n');
    const node = rowFor(result, 'models.providers.openai');
    expect(node.before).toBe(false);
    expect(node.after).toEqual({ enabled: true, harness: 'codex' });
    expect(node.status).toBe('change');

    const objectNode = await plan('openai', 'models:\n  providers:\n    openai:\n      enabled: false\n      api_key: $OPENAI_API_KEY\n');
    expect(rowFor(objectNode, 'models.providers.openai').after).toEqual({ enabled: true, api_key: '$OPENAI_API_KEY', harness: 'codex' });

    const anthropicOff = await plan('anthropic', 'models:\n  providers:\n    anthropic: false\n');
    expect(rowFor(anthropicOff, 'models.providers.anthropic').after).toBe(true);
    expect(anthropicOff.rows.some((r) => r.path === 'models.providers.openai')).toBe(false);
  });

  it('keeps background AI rows for the openai preset', async () => {
    const result = await plan('openai', 'conversations:\n  title_model: claude-haiku-4-5\n');
    for (const path of [
      'conversations.title_model',
      'conversations.compaction_model',
      'conversations.fork_summary_model',
      'conversations.handoff_author_model',
      'models.status_review_model',
      'memory.extraction.model',
      'tts.summarizer.model',
    ]) {
      const r = rowFor(result, path);
      expect(r.status, path).toBe('skipped');
      expect(r.reason, path).toBeTruthy();
    }
    expect(rowFor(result, 'conversations.title_model').after).toBe('claude-haiku-4-5');
    expect(rowFor(result, 'models.default_conversation_model').after).toBe('gpt-6-sol');
  });

  it('digest changes when config changes', async () => {
    const a = await plan('anthropic', 'workhorses:\n  mid: claude-opus-5-5\n');
    const b = await plan('anthropic', 'workhorses:\n  mid: claude-sonnet-5-5\n');
    const again = await plan('anthropic', 'workhorses:\n  mid: claude-opus-5-5\n');
    expect(a.digest).not.toBe(b.digest);
    expect(a.digest).toBe(again.digest);
  });

  it('rejects an unknown preset id', async () => {
    await expect(planPresetApply('nope', deps())).rejects.toBeInstanceOf(UnknownPresetError);
  });
});
