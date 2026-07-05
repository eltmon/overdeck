import { describe, expect, it } from 'vitest';
import { mergeConfigs } from '../merge.js';
import type { YamlConfig } from '../schema.js';

/**
 * PAN-2395 regression — the 2026-07-05 incident: a YAML-coerced boolean in
 * tiered_execution (`callouts: off` round-tripped to `false`) made
 * validateTieredExecutionConfig throw out of EVERY config load, which falsely
 * ended a live conversation and blocked conversation creation. An invalid
 * tiered_execution block must DEGRADE (tiered staffing disabled, reason
 * surfaced) — never throw out of mergeConfigs.
 */
describe('invalid tiered_execution degrades instead of poisoning config load (PAN-2395)', () => {
  const incidentShapedConfig = {
    tiered_execution: {
      enabled: true,
      tiers: {
        cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] },
      },
      supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'all' },
      // The incident: YAML 1.1 coerced unquoted `off` to boolean false.
      feed: { callouts: false },
      compaction_reroute: false,
    },
  } as unknown as YamlConfig;

  it('mergeConfigs does not throw and disables tiered staffing with the reason surfaced', () => {
    let merged: ReturnType<typeof mergeConfigs> | undefined;
    expect(() => {
      merged = mergeConfigs(incidentShapedConfig);
    }).not.toThrow();

    expect(merged!.config.tieredExecution.enabled).toBe(false);
    expect(merged!.config.tieredExecutionInvalid?.reason).toMatch(/callouts/);
  });

  it('a valid tiered_execution block still validates and enables normally', () => {
    const valid = {
      tiered_execution: {
        enabled: true,
        tiers: {
          cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] },
        },
        supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'all' },
      },
    } as unknown as YamlConfig;

    const merged = mergeConfigs(valid);
    expect(merged.config.tieredExecution.enabled).toBe(true);
    expect(merged.config.tieredExecutionInvalid).toBeUndefined();
  });
});
