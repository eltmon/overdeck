import { describe, expect, it } from 'vitest';

import { mergeConfigs } from '../../../lib/config-yaml/merge.js';
import type { YamlConfig } from '../../../lib/config-yaml/schema.js';
import { checkTierFitnessConfig } from '../doctor-tier-fitness.js';

function depsFor(config: ReturnType<typeof mergeConfigs>['config']) {
  return { loadConfig: () => ({ config }) as ReturnType<typeof import('../../../lib/config-yaml/load.js').loadConfigSync> };
}

function merged(yaml: Partial<YamlConfig>) {
  return mergeConfigs(yaml as YamlConfig).config;
}

describe('checkTierFitnessConfig', () => {
  it("warns when an enabled tier maps expert to claude-haiku-4-5, naming the tier path and 'expert'", () => {
    const config = merged({
      tiered_execution: {
        enabled: true,
        tiers: {
          cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
          standard: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium', 'complex'] },
          frontier: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['expert'] },
        },
        supervisor: { model: 'claude-opus-4-8', harness: 'claude-code', subscribe: 'flagged' },
      },
    } as unknown as Partial<YamlConfig>);

    const result = checkTierFitnessConfig(depsFor(config));
    expect(result.name).toBe('Tiered execution');
    expect(result.status).toBe('warn');
    expect(result.message).toContain('tiered_execution.tiers.');
    expect(result.message).toContain('expert');
  });

  it('returns ok for the tier-table.test.ts validConfig shape (haiku/sonnet-5/opus-4-8)', () => {
    const config = merged({
      tiered_execution: {
        enabled: true,
        tiers: {
          cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
          standard: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium', 'complex'] },
          frontier: { model: 'claude-opus-4-8', harness: 'claude-code', difficulties: ['expert'] },
        },
        supervisor: { model: 'claude-opus-4-8', harness: 'claude-code', subscribe: 'flagged' },
        replay_threshold: 0.5,
      },
    } as unknown as Partial<YamlConfig>);

    expect(checkTierFitnessConfig(depsFor(config)).status).toBe('ok');
  });

  it('returns error with the degraded reason for the PAN-2395 incident-shaped config (feed.callouts: false)', () => {
    const config = merged({
      tiered_execution: {
        enabled: true,
        tiers: {
          cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] },
        },
        supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'all' },
        feed: { callouts: false },
        compaction_reroute: false,
      },
    } as unknown as Partial<YamlConfig>);

    expect(config.tieredExecutionInvalid).toBeDefined();
    const result = checkTierFitnessConfig(depsFor(config));
    expect(result.status).toBe('error');
    expect(result.message).toContain(config.tieredExecutionInvalid!.reason);
  });

  it('disabled: warns with a roles.work.model prefix when roles.work.model is claude-haiku-4-5', () => {
    const config = merged({ roles: { work: { model: 'claude-haiku-4-5' } } } as unknown as Partial<YamlConfig>);
    expect(config.tieredExecution.enabled).toBe(false);

    const result = checkTierFitnessConfig(depsFor(config));
    expect(result.status).toBe('warn');
    expect(result.message.startsWith('roles.work.model')).toBe(true);
  });

  it('disabled: a workhorse-class roles.work (claude-sonnet-5) still warns about expert only — do not "fix" this', () => {
    // With tiered execution off, roles.work owns every difficulty including
    // expert, and no workhorse-class model fits the expert band. This warn is
    // the intended nudge to enable tiered execution (FIX text says so).
    const config = merged({ roles: { work: { model: 'claude-sonnet-5' } } } as unknown as Partial<YamlConfig>);

    const result = checkTierFitnessConfig(depsFor(config));
    expect(result.status).toBe('warn');
    expect(result.message).toContain('expert');
    expect(result.message).not.toContain('medium');
    expect(result.message).not.toContain('complex');
  });

  it('disabled: returns error when roles.work cannot be resolved', () => {
    const config = merged({});
    config.roles = { work: { model: 'not a valid model id!!' } } as never;

    const result = checkTierFitnessConfig(depsFor(config));
    expect(result.status).toBe('error');
    expect(result.message).toContain('roles.work.model could not be resolved');
  });
});
