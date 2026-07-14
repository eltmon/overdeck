import { describe, expect, it } from 'vitest';
import { IMPLICIT_TIER_NAME, resolveImplicitStaffing, resolveStaffing } from '../staffing.js';
import { resolveModel } from '../../config-yaml/roles.js';
import type { VBriefItem } from '../../vbrief/types.js';

const WORK_ROLES = { work: { model: 'claude-sonnet-5' } } as never;

function item(id: string, metadata: Record<string, unknown> = {}): Pick<VBriefItem, 'id' | 'title' | 'metadata'> {
  return { id, title: `${id} title`, metadata: metadata as VBriefItem['metadata'] };
}

function explicitTiered(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    tiers: {
      cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
      standard: { model: 'gpt-5.5', harness: 'codex', difficulties: ['medium', 'complex', 'expert'] },
    },
    difficultyToTier: { trivial: 'cheap', simple: 'cheap', medium: 'standard', complex: 'standard', expert: 'standard' },
    byKind: {},
    ...overrides,
  } as never;
}

describe('resolveStaffing (PAN-2397 W1 — Always Tiered)', () => {
  it('explicit tier table staffs by difficulty when enabled', () => {
    const staffing = resolveStaffing(item('task', { difficulty: 'medium' }), {
      config: { roles: WORK_ROLES, tieredExecution: explicitTiered() } as never,
    });
    expect(staffing).toMatchObject({ tierName: 'standard', model: 'gpt-5.5', harness: 'codex', implicit: false });
  });

  it('no tiered config → implicit tier from roles.work, provider-default harness', () => {
    const staffing = resolveStaffing(item('task', { difficulty: 'medium' }), {
      config: { roles: WORK_ROLES } as never,
    });
    expect(staffing.tierName).toBe(IMPLICIT_TIER_NAME);
    expect(staffing.implicit).toBe(true);
    expect(staffing.model).toBe('claude-sonnet-5');
    expect(staffing.harness).toBe('claude-code');
  });

  it('implicit staffing is byte-identical to determineModel resolution (same resolveModel + spawnKey)', () => {
    const config = { roles: WORK_ROLES } as never;
    const spawnKey = 'work:PAN-2397';
    const expected = resolveModel('work', undefined, config, spawnKey);
    const staffing = resolveStaffing(item('task'), { config, spawnKey });
    expect(staffing.model).toBe(expected);
  });

  it('tiered disabled globally with no plan override → implicit tier', () => {
    const staffing = resolveStaffing(item('task', { difficulty: 'expert' }), {
      config: { roles: WORK_ROLES, tieredExecution: explicitTiered({ enabled: false }) } as never,
    });
    expect(staffing.implicit).toBe(true);
  });

  it('per-issue plan override enables the explicit table over a disabled global flag', () => {
    const staffing = resolveStaffing(item('task', { difficulty: 'trivial' }), {
      config: { roles: WORK_ROLES, tieredExecution: explicitTiered({ enabled: false }) } as never,
      planMetadata: { tiered_execution: 'on' },
    });
    expect(staffing).toMatchObject({ tierName: 'cheap', model: 'claude-haiku-4-5', implicit: false });
  });

  it('explicit table that cannot place a task falls through to the implicit tier (D-explicit-gap)', () => {
    // Empty tier table with enabled=true: resolveTier throws → implicit staffing.
    const staffing = resolveStaffing(item('task', {}), {
      config: {
        roles: WORK_ROLES,
        tieredExecution: { enabled: true, tiers: {}, difficultyToTier: {}, byKind: {} } as never,
      } as never,
    });
    expect(staffing.implicit).toBe(true);
    expect(staffing.model).toBe('claude-sonnet-5');
  });

  it('per-task metadata.model override wins inside the explicit table', () => {
    const staffing = resolveStaffing(item('task', { difficulty: 'trivial', model: 'kimi-k2.7-code' }), {
      config: { roles: WORK_ROLES, tieredExecution: explicitTiered() } as never,
    });
    expect(staffing.model).toBe('kimi-k2.7-code');
    expect(staffing.implicit).toBe(false);
  });

  it('fails loudly when the implicit tier is needed but roles.work is unresolvable', () => {
    expect(() => resolveImplicitStaffing({} as never)).toThrow();
  });
});

describe('distribution tiers (PAN-2391 / PAN-2397 W2)', () => {
  function distributionConfig() {
    return {
      roles: WORK_ROLES,
      tieredExecution: {
        enabled: true,
        tiers: {
          standard: {
            model: 'gpt-5.5',
            harness: 'codex',
            difficulties: ['medium'],
            distribution: [
              { model: 'gpt-5.5', harness: 'codex', weight: 40 },
              { model: 'glm-5.2', harness: 'ohmypi', weight: 30 },
              { model: 'kimi-k2.7-code', harness: 'ohmypi', weight: 30 },
            ],
          },
        },
        difficultyToTier: { medium: 'standard' },
        byKind: {},
      },
    } as never;
  }

  it('same task always resolves to the same distribution entry', () => {
    const config = distributionConfig();
    const first = resolveStaffing(item('task-7', { difficulty: 'medium' }), { config, spawnKey: 'work:PAN-1' });
    for (let i = 0; i < 5; i += 1) {
      const again = resolveStaffing(item('task-7', { difficulty: 'medium' }), { config, spawnKey: 'work:PAN-1' });
      expect(again).toEqual(first);
    }
    expect(first.tierName).toBe('standard');
    expect(first.implicit).toBe(false);
  });

  it('spreads tasks across entries roughly by weight', async () => {
    const { pickDistributionEntry } = await import('../staffing.js');
    const entries = [
      { model: 'gpt-5.5', harness: 'codex', weight: 40 },
      { model: 'glm-5.2', harness: 'ohmypi', weight: 30 },
      { model: 'kimi-k2.7-code', harness: 'ohmypi', weight: 30 },
    ] as never;
    const counts: Record<string, number> = {};
    for (let i = 0; i < 1000; i += 1) {
      const picked = pickDistributionEntry(entries, `work:PAN-1:task-${i}`);
      counts[picked.model] = (counts[picked.model] ?? 0) + 1;
    }
    expect(counts['gpt-5.5']).toBeGreaterThan(320);
    expect(counts['gpt-5.5']).toBeLessThan(480);
    expect(counts['glm-5.2']).toBeGreaterThan(220);
    expect(counts['kimi-k2.7-code']).toBeGreaterThan(220);
  });

  it('per-task metadata.model override outranks the distribution', () => {
    const staffing = resolveStaffing(item('task-7', { difficulty: 'medium', model: 'claude-haiku-4-5' }), {
      config: distributionConfig(),
      spawnKey: 'work:PAN-1',
    });
    expect(staffing.model).toBe('claude-haiku-4-5');
  });
});
