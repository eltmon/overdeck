import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODEL_REFS,
  DEFAULT_ROLES,
  DEFAULT_WORKHORSES,
  PARENT_MODEL_REF,
  derefWorkhorse,
  mergeConfigs,
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
      ship: { model: 'workhorse:mid', harness: 'pi' },
      flywheel: { harness: 'claude-code', model: 'claude-opus-4-7', effort: 'high', maxAgents: 8, scope: 'pan-only' },
    },
  };
}

describe('role model configuration', () => {
  it('exports default model refs for every role', () => {
    expect(Object.keys(DEFAULT_MODEL_REFS).sort()).toEqual(['flywheel', 'plan', 'review', 'ship', 'test', 'work']);
  });

  it('exports the parent model sentinel', () => {
    expect(PARENT_MODEL_REF).toBe('parent');
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

  it('uses sub-role overrides before role-level model refs', () => {
    const config = roleConfig();

    expect(resolveModel('review', 'security', config)).toBe('claude-haiku-4-5');
    expect(resolveModel('review', 'requirements', config)).toBe('glm-5.1');
  });

  it('resolves parent sub-role refs through the parent role model', () => {
    const config = roleConfig();
    config.roles!.review!.sub!.security.model = PARENT_MODEL_REF;

    expect(resolveModel('review', 'security', config)).toBe('claude-opus-4-7');
  });

  it('resolves parent sub-role refs through default role refs when the role model is absent', () => {
    const config = {
      workhorses: WORKHORSES,
      roles: {
        review: {
          sub: {
            security: { model: PARENT_MODEL_REF },
          },
        },
      },
    } as Pick<NormalizedConfig, 'workhorses' | 'roles'>;

    expect(resolveModel('review', 'security', config)).toBe('claude-opus-4-7');
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

  it('accepts parent sub-role refs during config-load validation', () => {
    const { config } = mergeConfigs({
      roles: {
        review: {
          model: 'workhorse:mid',
          sub: {
            security: { model: PARENT_MODEL_REF },
          },
        },
      },
    });

    expect(config.roles?.review?.sub?.security?.model).toBe(PARENT_MODEL_REF);
    expect(resolveModel('review', 'security', config)).toBe('claude-sonnet-4-6');
  });

  it('rejects parent refs for role-level models and workhorse slots', () => {
    expect(() => mergeConfigs({
      roles: { review: { model: PARENT_MODEL_REF } },
    })).toThrow('config.yaml: roles.review.model cannot be parent; parent is a resolve-only sub-role sentinel');

    expect(() => mergeConfigs({
      workhorses: { mid: PARENT_MODEL_REF },
    })).toThrow('config.yaml: workhorses.mid cannot be parent; parent is valid only for sub-role models');
  });

  it('fails fast when dereferencing the parent sentinel directly', () => {
    expect(() => derefWorkhorse(PARENT_MODEL_REF, roleConfig(), 'roles.review.sub.security.model'))
      .toThrow('config.yaml: roles.review.sub.security.model cannot be parent; parent is a resolve-only sub-role sentinel');
  });

  it('seeds default workhorses and roles when config omits both sections', () => {
    const { config } = mergeConfigs({});

    expect(config.workhorses).toEqual(DEFAULT_WORKHORSES);
    expect(config.roles).toEqual(DEFAULT_ROLES);
    expect(resolveModel('work', 'inspect', config)).toBe('claude-haiku-4-5');
    expect(resolveModel('review', 'security', config)).toBe('claude-opus-4-7');
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
          harness: 'pi',
          model: 'claude-sonnet-4-6',
          effort: 'medium',
          maxAgents: 4,
          scope: 'all-tracked-projects',
        },
      },
    });

    expect(config.roles?.flywheel).toEqual({
      harness: 'pi',
      model: 'claude-sonnet-4-6',
      effort: 'medium',
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
