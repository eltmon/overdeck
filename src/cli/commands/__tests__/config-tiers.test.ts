import { describe, expect, it } from 'vitest';
import { mergeConfigs } from '../../../lib/config-yaml.js';
import { resolveModel } from '../../../lib/config-yaml/roles.js';
import { effectiveTierTable } from '../../../lib/agents/tier-table.js';
import { formatEffectiveTierTable } from '../config-tiers.js';

// PAN-4191: `pan admin config tiers` shows each tier's effective model and
// flags the tiers that shadow roles.work while tiered execution is on.
function load(enabled: boolean) {
  return mergeConfigs({
    workhorses: { mid: 'claude-opus-5-5', expensive: 'claude-opus-5-5' },
    roles: { work: { model: 'workhorse:mid' } },
    tiered_execution: {
      enabled,
      tiers: {
        trivial: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial'] },
        'simple-medium': { model: 'workhorse:mid', harness: 'claude-code', difficulties: ['simple', 'medium'] },
        complex: { model: 'workhorse:expensive', harness: 'claude-code', difficulties: ['complex', 'expert'] },
      },
      supervisor: { model: 'workhorse:expensive', harness: 'claude-code', subscribe: 'flagged' },
      replay_threshold: 0.5,
    },
  }).config;
}

describe('effectiveTierTable / pan admin config tiers (PAN-4191)', () => {
  it('resolves workhorse refs and marks only the tiers that differ from roles.work', () => {
    const config = load(true);
    const table = effectiveTierTable(config.tieredExecution, resolveModel('work', undefined, config));

    expect(table.workModel).toBe('claude-opus-5-5');
    expect(table.rows.map((row) => [row.tierName, row.ref, row.model, row.overridesWork])).toEqual([
      ['trivial', 'claude-haiku-4-5', 'claude-haiku-4-5', true],
      ['simple-medium', 'workhorse:mid', 'claude-opus-5-5', false],
      ['complex', 'workhorse:expensive', 'claude-opus-5-5', false],
    ]);

    const text = formatEffectiveTierTable(table).join('\n');
    expect(text).toContain('roles.work → claude-opus-5-5');
    expect(text).toContain('simple-medium  workhorse:mid → claude-opus-5-5');
    expect(text).toMatch(/trivial {2}claude-haiku-4-5 .*\[overrides roles\.work\]/);
    expect(text).not.toMatch(/simple-medium .*\[overrides roles\.work\]/);
  });

  it('never marks an override while tiered execution is disabled', () => {
    const config = load(false);
    const table = effectiveTierTable(config.tieredExecution, resolveModel('work', undefined, config));
    expect(table.rows.some((row) => row.overridesWork)).toBe(false);
    expect(formatEffectiveTierTable(table).join('\n')).toContain('disabled');
  });

  it('reports an invalid tier table instead of listing tiers', () => {
    const text = formatEffectiveTierTable({ enabled: false, workModel: 'claude-opus-5-5', rows: [] }, 'bad ref').join('\n');
    expect(text).toContain('INVALID and disabled: bad ref');
  });
});
