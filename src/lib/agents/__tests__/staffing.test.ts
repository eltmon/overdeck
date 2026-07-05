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
    const staffing = resolveStaffing(item('bead', { difficulty: 'medium' }), {
      config: { roles: WORK_ROLES, tieredExecution: explicitTiered() } as never,
    });
    expect(staffing).toMatchObject({ tierName: 'standard', model: 'gpt-5.5', harness: 'codex', implicit: false });
  });

  it('no tiered config → implicit tier from roles.work, provider-default harness', () => {
    const staffing = resolveStaffing(item('bead', { difficulty: 'medium' }), {
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
    const staffing = resolveStaffing(item('bead'), { config, spawnKey });
    expect(staffing.model).toBe(expected);
  });

  it('tiered disabled globally with no plan override → implicit tier', () => {
    const staffing = resolveStaffing(item('bead', { difficulty: 'expert' }), {
      config: { roles: WORK_ROLES, tieredExecution: explicitTiered({ enabled: false }) } as never,
    });
    expect(staffing.implicit).toBe(true);
  });

  it('per-issue plan override enables the explicit table over a disabled global flag', () => {
    const staffing = resolveStaffing(item('bead', { difficulty: 'trivial' }), {
      config: { roles: WORK_ROLES, tieredExecution: explicitTiered({ enabled: false }) } as never,
      planMetadata: { tiered_execution: 'on' },
    });
    expect(staffing).toMatchObject({ tierName: 'cheap', model: 'claude-haiku-4-5', implicit: false });
  });

  it('explicit table that cannot place a bead falls through to the implicit tier (D-explicit-gap)', () => {
    // Empty tier table with enabled=true: resolveTier throws → implicit staffing.
    const staffing = resolveStaffing(item('bead', {}), {
      config: {
        roles: WORK_ROLES,
        tieredExecution: { enabled: true, tiers: {}, difficultyToTier: {}, byKind: {} } as never,
      } as never,
    });
    expect(staffing.implicit).toBe(true);
    expect(staffing.model).toBe('claude-sonnet-5');
  });

  it('per-bead metadata.model override wins inside the explicit table', () => {
    const staffing = resolveStaffing(item('bead', { difficulty: 'trivial', model: 'kimi-k2.7-code' }), {
      config: { roles: WORK_ROLES, tieredExecution: explicitTiered() } as never,
    });
    expect(staffing.model).toBe('kimi-k2.7-code');
    expect(staffing.implicit).toBe(false);
  });

  it('fails loudly when the implicit tier is needed but roles.work is unresolvable', () => {
    expect(() => resolveImplicitStaffing({} as never)).toThrow();
  });
});
