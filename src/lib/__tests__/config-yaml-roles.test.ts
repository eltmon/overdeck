import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODEL_REFS,
  DEFAULT_ROLES,
  DEFAULT_WORKHORSES,
  computeModelOrigin,
  derefWorkhorse,
  derivePercentPick,
  mergeConfigs,
  pickPercentModelRef,
  resolveModel,
  stripProjectTtsEndpoint,
  type NormalizedConfig,
} from '../config-yaml.js';
import type { Role } from '../agents.js';

const WORKHORSES = {
  expensive: 'claude-opus-4-7',
  mid: 'claude-sonnet-4-6',
  cheap: 'claude-haiku-4-5',
};

function roleConfig(): Pick<NormalizedConfig, 'workhorses' | 'roles'> {
  return {
    workhorses: WORKHORSES,
    roles: {
      plan: { model: 'workhorse:expensive' },
      work: { model: 'workhorse:mid' },
      review: {
        model: 'workhorse:expensive',
        sub: {
          security: { model: 'workhorse:cheap' },
          requirements: { model: 'glm-5.1' },
        },
      },
      test: { model: 'gemini-3.1-pro-preview' },
      ship: { model: 'workhorse:mid', harness: 'ohmypi' },
      flywheel: { harness: 'claude-code', model: 'claude-opus-4-7', effort: 'high', maxAgents: 8, scope: 'pan-only' },
    },
  };
}

describe('role model configuration', () => {
  it('exports default model refs for every role', () => {
    expect(Object.keys(DEFAULT_MODEL_REFS).sort()).toEqual(['flywheel', 'plan', 'review', 'sequencer', 'ship', 'strike', 'test', 'work']);
  });

  it('dereferences workhorse refs and passes literal model ids through', () => {
    const config = roleConfig();

    expect(derefWorkhorse('workhorse:expensive', config, 'roles.plan.model')).toBe('claude-opus-4-7');
    expect(derefWorkhorse('kimi-k2.6-flash', config, 'roles.work.model')).toBe('kimi-k2.6-flash');
  });

  it('resolves all five role models through workhorse or literal refs', () => {
    const config = roleConfig();
    const expected: Record<Role, string> = {
      plan: 'claude-opus-4-7',
      work: 'claude-sonnet-4-6',
      review: 'claude-opus-4-7',
      test: 'gemini-3.1-pro-preview',
      ship: 'claude-sonnet-4-6',
      flywheel: 'claude-opus-4-7',
    };

    for (const role of Object.keys(expected) as Role[]) {
      expect(resolveModel(role, undefined, config)).toBe(expected[role]);
    }
  });

  it('honors configured roles.plan.model through the configured expensive workhorse', () => {
    const { config } = mergeConfigs({
      workhorses: {
        expensive: 'gpt-5.5',
      },
      roles: {
        plan: { model: 'workhorse:expensive' },
      },
    });

    expect(resolveModel('plan', undefined, config)).toBe('gpt-5.5');
  });

  it('uses sub-role overrides before role-level model refs', () => {
    const config = roleConfig();

    expect(resolveModel('review', 'security', config)).toBe('claude-haiku-4-5');
    expect(resolveModel('review', 'requirements', config)).toBe('glm-5.1');
  });

  it('rejects unknown workhorse slots with the offending field path', () => {
    expect(() => mergeConfigs({
      roles: { review: { model: 'workhorse:missing' } },
    })).toThrow('config.yaml: roles.review.model references workhorse:missing but workhorses.missing is not defined');
  });

  it('rejects chained workhorse refs at config parse time', () => {
    expect(() => mergeConfigs({
      workhorses: { cheap: 'workhorse:mid', mid: 'claude-sonnet-4-6' },
    })).toThrow('config.yaml: workhorses.cheap cannot reference another workhorse');
  });

  // PAN-1048 review feedback 003 (REQ-18): the manual-YAML config-load path
  // must reject any workhorse key outside the canonical three slots (the HTTP
  // settings API already gates this at settings-api.ts:246-253). Without this
  // guard a hand-edited config.yaml with workhorses.tiny: claude-haiku-4-5
  // passed silently, then the role config could never reference it because the
  // role schema only knows the canonical three.
  it('rejects unknown workhorse slot keys with a precise field-path error', () => {
    expect(() => mergeConfigs({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      workhorses: { tiny: 'claude-haiku-4-5' } as any,
    })).toThrow('config.yaml: unknown workhorse slot workhorses.tiny. Valid slots: expensive, mid, cheap.');

    expect(() => mergeConfigs({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      workhorses: { tiny: 'claude-haiku-4-5', huge: 'claude-opus-4-7' } as any,
    })).toThrow('config.yaml: unknown workhorse slots workhorses.tiny, workhorses.huge. Valid slots: expensive, mid, cheap.');
  });

  it('round-trips workhorses, role models, harness, and sub-role overrides through merged config', () => {
    const { config } = mergeConfigs({
      workhorses: WORKHORSES,
      roles: {
        review: {
          model: 'workhorse:expensive',
          harness: 'claude-code',
          sub: {
            performance: { model: 'workhorse:mid' },
          },
        },
      },
    });

    expect(config.workhorses).toEqual(WORKHORSES);
    expect(config.roles?.review?.model).toBe('workhorse:expensive');
    expect(config.roles?.review?.harness).toBe('claude-code');
    expect(config.roles?.review?.sub?.performance?.model).toBe('workhorse:mid');
    expect(resolveModel('review', 'performance', config)).toBe('claude-sonnet-4-6');
  });

  it('seeds default workhorses and roles when config omits both sections', () => {
    const { config } = mergeConfigs({});

    expect(config.workhorses).toEqual(DEFAULT_WORKHORSES);
    expect(config.roles).toEqual(DEFAULT_ROLES);
    expect(config.roles?.review?.mode).toBe('quick');
    expect(resolveModel('work', 'inspect', config)).toBe('claude-haiku-4-5');
    expect(resolveModel('review', 'security', config)).toBe('claude-opus-4-8');
  });

  it('uses project review mode over lower-precedence global review mode', () => {
    const { config } = mergeConfigs(
      {
        roles: {
          review: { model: 'workhorse:expensive', mode: 'full' },
        },
      },
      {
        roles: {
          review: { model: 'workhorse:expensive', mode: 'quick' },
        },
      },
    );

    expect(config.roles?.review?.mode).toBe('full');
  });

  it('rejects review mode values outside quick or full', () => {
    expect(() => mergeConfigs({
      roles: {
        review: { model: 'workhorse:expensive', mode: 'extended' as never },
      },
    })).toThrow('config.yaml: roles.review.mode must be quick or full');
  });

  it('seeds missing roles while preserving partial user role config', () => {
    const { config } = mergeConfigs({
      roles: {
        work: {
          model: 'gpt-5.5',
          sub: {
            inspect: { model: 'claude-sonnet-4-6' },
          },
        },
      },
    });

    expect(config.roles?.work?.model).toBe('gpt-5.5');
    expect(config.roles?.work?.sub?.inspect?.model).toBe('claude-sonnet-4-6');
    expect(config.roles?.work?.sub?.['inspect-deep']?.model).toBe('workhorse:mid');
    expect(config.roles?.plan).toEqual(DEFAULT_ROLES.plan);
    expect(config.roles?.ship).toEqual(DEFAULT_ROLES.ship);
    expect(config.roles?.flywheel).toEqual(DEFAULT_ROLES.flywheel);
  });

  it('accepts and validates flywheel role fields', () => {
    const { config } = mergeConfigs({
      roles: {
        flywheel: {
          harness: 'ohmypi',
          model: 'claude-sonnet-4-6',
          effort: 'medium',
          maxAgents: 4,
          scope: 'all-tracked-projects',
        },
      },
    });

    expect(config.roles?.flywheel).toEqual({
      harness: 'ohmypi',
      model: 'claude-sonnet-4-6',
      effort: 'medium',
      minAgents: 4,
      maxAgents: 4,
      scope: 'all-tracked-projects',
    });
  });

  it('rejects invalid flywheel role fields', () => {
    expect(() => mergeConfigs({
      roles: {
        flywheel: { model: 'claude-opus-4-7', maxAgents: 0 },
      },
    })).toThrow('config.yaml: roles.flywheel.maxAgents must be a positive integer');
  });

  it('accepts xhigh/max effort on an Opus 4.7 role', () => {
    const { config } = mergeConfigs({
      roles: {
        work: { model: 'claude-opus-4-7', effort: 'xhigh' },
        review: { model: 'workhorse:expensive', effort: 'max' },
      },
    });

    expect(config.roles?.work?.effort).toBe('xhigh');
    expect(config.roles?.review?.effort).toBe('max');
  });

  it('rejects an effort level the role model does not support (model-aware)', () => {
    expect(() => mergeConfigs({
      roles: {
        // claude-sonnet-4-6 supports low/medium/high only — xhigh is Opus-4.7-only.
        test: { model: 'claude-sonnet-4-6', effort: 'xhigh' },
      },
    })).toThrow("config.yaml: roles.test.effort 'xhigh' is not supported by claude-sonnet-4-6 (supported: low, medium, high)");
  });

  it('rejects an effort value outside the enum', () => {
    expect(() => mergeConfigs({
      roles: {
        work: { model: 'claude-opus-4-7', effort: 'maximum' as never },
      },
    })).toThrow('config.yaml: roles.work.effort must be one of low, medium, high, xhigh, max');
  });

  it('seeds missing workhorse slots while preserving user-defined slots', () => {
    // PAN-1067 added MODEL_DEPRECATIONS that transparently maps
    // 'gpt-5.5-mini' → 'gpt-5.4-mini' (a hallucinated tier that never
    // shipped). Use 'gpt-5.4-mini' here so the assertion exercises the
    // user-overlay-preserved path without tripping the deprecation rewrite.
    const { config } = mergeConfigs({
      workhorses: {
        mid: 'gpt-5.4-mini',
      },
    });

    expect(config.workhorses).toEqual({
      ...DEFAULT_WORKHORSES,
      mid: 'gpt-5.4-mini',
    });
    expect(resolveModel('work', undefined, config)).toBe('gpt-5.4-mini');
  });
});

describe('percent model pick derivation (PAN-2053)', () => {
  const weighted: Pick<NormalizedConfig, 'workhorses' | 'roles'> = {
    workhorses: WORKHORSES,
    roles: {
      work: { model: [
        { model: 'workhorse:mid', weight: 70 },
        { model: 'gpt-5.5', weight: 30 },
      ] },
      review: { model: 'workhorse:expensive' }, // scalar — no distribution to explain
    },
  };

  it('derivePercentPick.chosen always equals pickPercentModelRef', () => {
    const entries = weighted.roles!.work!.model as Array<{ model: string; weight: number }>;
    for (let i = 0; i < 200; i++) {
      const key = `work:PAN-${i}`;
      expect(derivePercentPick(entries, key).chosen).toBe(pickPercentModelRef(entries, key));
    }
  });

  it('bands are contiguous integer ranges covering [0,total), exactly one chosen by the bucket', () => {
    const entries = weighted.roles!.work!.model as Array<{ model: string; weight: number }>;
    const pick = derivePercentPick(entries, 'work:PAN-1832');
    expect(pick.total).toBe(100);
    // contiguous integer bands: each starts where the previous ended; widths = weights
    let cursor = 0;
    for (let i = 0; i < pick.bands.length; i++) {
      const b = pick.bands[i];
      expect(b.lo).toBe(cursor);
      expect(b.hi - b.lo).toBe(entries[i].weight);
      cursor = b.hi;
    }
    expect(cursor).toBe(pick.total);
    // bucket is an integer in [0, total) and the chosen band contains it
    expect(Number.isInteger(pick.bucket)).toBe(true);
    expect(pick.bucket).toBeGreaterThanOrEqual(0);
    expect(pick.bucket).toBeLessThan(pick.total);
    const chosen = pick.bands.filter((b) => b.chosen);
    expect(chosen).toHaveLength(1);
    expect(pick.bucket).toBeGreaterThanOrEqual(chosen[0].lo);
    expect(pick.bucket).toBeLessThan(chosen[0].hi);
  });

  it('proportional percentages spread across sequential common-prefix keys (PAN-2055)', () => {
    // Regression: the old fnv1a32/2^32 bucketing clustered `work:PAN-19xx` keys into
    // one band (kimi 68% / glm 30% / gpt 2%). The fmix32 + modulo bucket spreads a
    // 33/33/34 distribution roughly evenly — each band within ±15pts of its weight.
    const entries = [
      { model: 'kimi-k2.7-code', weight: 33 },
      { model: 'glm-5.2', weight: 33 },
      { model: 'gpt-5.5', weight: 34 },
    ];
    const counts: Record<string, number> = {};
    let total = 0;
    for (let n = 1900; n <= 2060; n++) {
      const m = pickPercentModelRef(entries, `work:PAN-${n}`);
      counts[m] = (counts[m] ?? 0) + 1;
      total++;
    }
    for (const e of entries) {
      const share = (counts[e.model] ?? 0) / total;
      expect(Math.abs(share - e.weight / 100), `${e.model} share ${(share * 100).toFixed(0)}%`).toBeLessThan(0.15);
    }
  });

  it('computeModelOrigin returns null for a scalar role', () => {
    expect(computeModelOrigin('review', 'review:PAN-1832', weighted)).toBeNull();
  });

  it('computeModelOrigin derefs workhorse refs and matches resolveModel', () => {
    const spawnKey = 'work:PAN-1832';
    const origin = computeModelOrigin('work', spawnKey, weighted);
    expect(origin).not.toBeNull();
    expect(origin!.spawnKey).toBe(spawnKey);
    // resolved equals what the agent would actually spawn with for this exact key
    expect(origin!.resolved).toBe(resolveModel('work', undefined, weighted, spawnKey));
    // workhorse:mid is dereffed to the real model id for display
    expect(origin!.distribution[0].model).toBe(derefWorkhorse('workhorse:mid', weighted));
    expect(origin!.distribution[1].model).toBe('gpt-5.5');
    // exactly one entry chosen, and it names the resolved model
    const chosen = origin!.distribution.filter((d) => d.chosen);
    expect(chosen).toHaveLength(1);
    expect(chosen[0].model).toBe(origin!.resolved);
  });
});

describe('tts daemon configuration', () => {
  it('returns daemon defaults when config omits the tts section', () => {
    const { config } = mergeConfigs({});

    expect(config.tts).toEqual({
      enabled: false,
      voice: '',
      volume: 1,
      rate: 1,
      maxChars: 140,
      dropInfoWhenFull: true,
      lifecycle: true,
      daemonPort: 8787,
      daemonHost: '127.0.0.1',
      daemonAutoStart: false,
      voiceMap: {},
      mutedSources: [],
      utteranceTemplates: {},
      mutedIssues: [],
    });
  });

  it('merges daemon tts fields over defaults', () => {
    const { config } = mergeConfigs({
      tts: {
        enabled: true,
        voice: 'voice-system',
        statusVoice: 'voice-status',
        volume: 0.5,
        rate: 1.25,
        maxChars: 220,
        dropInfoWhenFull: false,
        daemonPort: 8788,
        daemonHost: 'localhost',
        daemon: { autoStart: true },
        voiceMap: { 'mergeStatus.merged': 'voice-merge' },
        mutedSources: ['merge-agent'],
        utteranceTemplates: { readyForMerge: '{issueId} can merge' },
        mutedIssues: ['PAN-123'],
      },
    });

    expect(config.tts).toEqual({
      enabled: true,
      voice: 'voice-system',
      statusVoice: 'voice-status',
      volume: 0.5,
      rate: 1.25,
      maxChars: 220,
      dropInfoWhenFull: false,
      lifecycle: true,
      daemonPort: 8788,
      daemonHost: 'localhost',
      daemonAutoStart: true,
      voiceMap: { 'mergeStatus.merged': 'voice-merge' },
      mutedSources: ['merge-agent'],
      utteranceTemplates: { readyForMerge: '{issueId} can merge' },
      mutedIssues: ['PAN-123'],
    });
  });

  it('strips daemon endpoints from project-scoped tts config', () => {
    expect(stripProjectTtsEndpoint({
      tts: {
        enabled: true,
        voice: 'voice-system',
        daemonHost: 'attacker.example',
        daemonPort: 80,
      },
    })).toEqual({
      tts: {
        enabled: true,
        voice: 'voice-system',
      },
    });
  });

  it('keeps tts.summarizer separate from daemon tts fields', () => {
    const { config } = mergeConfigs({
      tts: {
        enabled: true,
        voice: 'voice-system',
        summarizer: {
          enabled: true,
          model: 'claude-haiku-4-5',
          batch_window_seconds: 30,
        },
      },
    });

    expect(config.tts.enabled).toBe(true);
    expect(config.tts.voice).toBe('voice-system');
    expect(config.ttsSummarizer).toEqual({
      enabled: true,
      model: 'claude-haiku-4-5',
      batchWindowSeconds: 30,
    });
  });
});
