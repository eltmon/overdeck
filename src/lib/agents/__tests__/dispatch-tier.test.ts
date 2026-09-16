import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { XBriefDocument, XBriefItem } from '../../xbrief/types.js';
import {
  assignDispatchTier,
  chooseDispatchTier,
  chooseTierAssignment,
  type TierAssignmentConfig,
} from '../dispatch-tier.js';
import { ResolveTierError } from '../resolve-tier.js';

vi.mock('../../config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config-yaml.js')>();
  return {
    ...actual,
    loadConfigSync: vi.fn(),
  };
});
vi.mock('../../xbrief/io.js', () => ({
  readWorkspacePlanSync: vi.fn(),
}));

import { loadConfigSync } from '../../config-yaml.js';
import { readWorkspacePlanSync } from '../../xbrief/io.js';
import { applyTierAssignment, logTierFitnessAtSpawn, resolveSingleWorkTierSpawnParams, resolveSlotTierSpawnParams } from '../spawn-prep.js';

const TIER_CONFIG: TierAssignmentConfig = {
  enabled: true,
  tiers: {
    cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
    standard: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium', 'complex'] },
    frontier: { model: 'claude-opus-4-8', harness: 'claude-code', difficulties: ['expert'] },
  },
  difficultyToTier: {
    trivial: 'cheap',
    simple: 'cheap',
    medium: 'standard',
    complex: 'standard',
    expert: 'frontier',
  },
};

const TIERING: TierAssignmentConfig = {
  enabled: true,
  tiers: {
    cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
    standard: { model: 'claude-sonnet-4-6', harness: 'claude-code', difficulties: ['medium'] },
    frontier: { model: 'claude-opus-4-8', harness: 'claude-code', difficulties: ['complex', 'expert'] },
  },
  difficultyToTier: {
    trivial: 'cheap',
    simple: 'cheap',
    medium: 'standard',
    complex: 'frontier',
    expert: 'frontier',
  },
};

function item(metadata: XBriefItem['metadata'], id = 'item-1'): Pick<XBriefItem, 'id' | 'title' | 'metadata'> {
  return { id, title: 'test item', metadata };
}

describe('assignDispatchTier', () => {
  it('resolves an expert item to the expert tier model and harness when enabled', () => {
    const assignment = assignDispatchTier(item({ difficulty: 'expert' }), TIER_CONFIG);
    expect(assignment).toEqual({
      dispatch: 'registered-slot',
      tierName: 'frontier',
      model: 'claude-opus-4-8',
      harness: 'claude-code',
    });
  });

  it('returns exactly the current dispatch lane with no model override when disabled', () => {
    const candidates: Array<Pick<XBriefItem, 'id' | 'title' | 'metadata'>> = [
      item({ difficulty: 'expert' }),
      item({ difficulty: 'simple', files_scope: ['a.ts'], files_scope_confidence: 'high' }),
      item({ difficulty: 'medium', files_scope: ['a.ts'], files_scope_confidence: 'high', readiness: 'ready' }),
    ];
    for (const candidate of candidates) {
      const disabled = assignDispatchTier(candidate, { ...TIER_CONFIG, enabled: false });
      expect(disabled).toEqual({ dispatch: chooseDispatchTier(candidate) });
      expect(assignDispatchTier(candidate, undefined)).toEqual({ dispatch: chooseDispatchTier(candidate) });
    }
  });

  it('honors the per-plan tiered_execution override in both directions', () => {
    const expert = item({ difficulty: 'expert' });
    const onWhileGloballyOff = assignDispatchTier(expert, { ...TIER_CONFIG, enabled: false }, { tiered_execution: 'on' });
    expect(onWhileGloballyOff.model).toBe('claude-opus-4-8');

    const offWhileGloballyOn = assignDispatchTier(expert, TIER_CONFIG, { tiered_execution: 'off' });
    expect(offWhileGloballyOn).toEqual({ dispatch: 'registered-slot' });
  });

  it('propagates a named ResolveTierError when enabled and nothing resolves', () => {
    expect(() => assignDispatchTier(item({}), TIER_CONFIG)).toThrow(ResolveTierError);
  });
});

describe('chooseTierAssignment', () => {
  it('returns the expert tier model+harness when tiered execution is enabled', () => {
    const assignment = chooseTierAssignment(item({ difficulty: 'expert' }), TIERING);
    expect(assignment).toEqual({
      dispatch: 'registered-slot',
      tierName: 'frontier',
      model: 'claude-opus-4-8',
      harness: 'claude-code',
    });
  });

  it('returns exactly chooseDispatchTier with no model override when tiering is disabled', () => {
    const items = [
      item({ difficulty: 'expert' }),
      item({ difficulty: 'trivial', files_scope: ['a.ts'], files_scope_confidence: 'high' }),
      item({ readiness: 'ready', files_scope: ['a.ts'], files_scope_confidence: 'high' }),
      item({}),
    ];
    for (const testItem of items) {
      for (const tiering of [undefined, { ...TIERING, enabled: false }]) {
        const assignment = chooseTierAssignment(testItem, tiering);
        expect(assignment).toEqual({ dispatch: chooseDispatchTier(testItem) });
        expect(assignment.model).toBeUndefined();
        expect(assignment.harness).toBeUndefined();
      }
    }
  });
});

describe('resolveSlotTierSpawnParams', () => {
  function planDoc(items: XBriefItem[], planMetadata?: Record<string, unknown>): XBriefDocument {
    return {
      xBRIEFInfo: { version: '0.6', created: '2026-07-02T00:00:00Z' },
      plan: {
        id: 'plan-1',
        title: 'test plan',
        status: 'running',
        metadata: planMetadata,
        items,
        edges: [],
      },
    };
  }

  function planItem(id: string, metadata: XBriefItem['metadata']): XBriefItem {
    return { id, title: id, status: 'pending', metadata };
  }

  function mockConfig(tieredExecution: TierAssignmentConfig): void {
    vi.mocked(loadConfigSync).mockReturnValue({
      config: { tieredExecution, roles: { work: { model: 'claude-sonnet-4-6' } } },
    } as unknown as ReturnType<typeof loadConfigSync>);
  }

  const IMPLICIT_PARAMS = {
    model: 'claude-sonnet-4-6',
    harness: undefined,
    tierName: 'default',
    implicit: true,
  };
  const IMPLICIT_PARAMS_EXPERT = { ...IMPLICIT_PARAMS, difficulty: 'expert' };

  beforeEach(() => {
    vi.mocked(loadConfigSync).mockReset();
    vi.mocked(readWorkspacePlanSync).mockReset();
  });

  it('carries the resolved tier model and harness into the spawn params when tiering is on', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([planItem('task-x', { difficulty: 'expert' })]));

    expect(resolveSlotTierSpawnParams('/ws', 'task-x')).toEqual({
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      tierName: 'frontier',
      implicit: false,
      difficulty: 'expert',
    });
  });

  it('staffs from the implicit roles.work tier when tiering is disabled (PAN-2397)', () => {
    mockConfig({ ...TIER_CONFIG, enabled: false });
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([planItem('task-x', { difficulty: 'expert' })]));

    expect(resolveSlotTierSpawnParams('/ws', 'task-x')).toEqual(IMPLICIT_PARAMS_EXPERT);
  });

  it('lets an explicit per-spawn model override outrank tier routing (PAN-3842: surfaces difficulty for fitness warn)', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([planItem('task-x', { difficulty: 'expert' })]));

    // Override precedence preserved: tier-resolved model/harness stay unset
    // so the spawn path keeps options.model as the FINAL selected model.
    // Difficulty is still surfaced so the caller can warn.
    expect(resolveSlotTierSpawnParams('/ws', 'task-x', 'claude-sonnet-5')).toEqual({
      difficulty: 'expert',
      explicitOverride: 'claude-sonnet-5',
    });
  });

  it('falls through to the implicit roles.work tier for an unlabeled item (PAN-2397)', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([planItem('task-x', {})]));

    expect(resolveSlotTierSpawnParams('/ws', 'task-x')).toEqual(IMPLICIT_PARAMS);
  });

  it('throws when tiering is enabled but the slot item is missing from the plan', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([planItem('other', { difficulty: 'medium' })]));

    expect(() => resolveSlotTierSpawnParams('/ws', 'task-x')).toThrow("item 'task-x' was not found");
  });

  it('falls through to role-default routing when tiering is enabled but no plan is readable', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(null);

    expect(resolveSlotTierSpawnParams('/ws', 'task-x')).toEqual({});
  });
});

describe('resolveSingleWorkTierSpawnParams', () => {
  function planDoc(items: XBriefItem[], planMetadata?: Record<string, unknown>): XBriefDocument {
    return {
      xBRIEFInfo: { version: '0.6', created: '2026-07-02T00:00:00Z' },
      plan: {
        id: 'plan-1',
        title: 'test plan',
        status: 'running',
        metadata: planMetadata,
        items,
        edges: [],
      },
    };
  }

  function planItem(id: string, metadata: XBriefItem['metadata'], status: XBriefItem['status'] = 'pending'): XBriefItem {
    return { id, title: id, status, metadata };
  }

  function mockConfig(tieredExecution: TierAssignmentConfig): void {
    vi.mocked(loadConfigSync).mockReturnValue({
      config: { tieredExecution, roles: { work: { model: 'claude-sonnet-4-6' } } },
    } as unknown as ReturnType<typeof loadConfigSync>);
  }

  const IMPLICIT_PARAMS = {
    model: 'claude-sonnet-4-6',
    harness: undefined,
    tierName: 'default',
    implicit: true,
  };

  beforeEach(() => {
    vi.mocked(loadConfigSync).mockReset();
    vi.mocked(readWorkspacePlanSync).mockReset();
  });

  it('routes tiered when global config is off but plan metadata opts in', () => {
    mockConfig({ ...TIER_CONFIG, enabled: false });
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
      planItem('cheap', { difficulty: 'simple' }),
      planItem('frontier', { difficulty: 'expert' }),
    ], { tiered_execution: 'on' }));

    expect(resolveSingleWorkTierSpawnParams('/ws')).toEqual({
      model: 'claude-haiku-4-5',
      harness: 'claude-code',
      tierName: 'cheap',
      implicit: false,
      planDifficulties: ['simple', 'expert'],
      planItems: [
        { id: 'cheap', difficulty: 'simple' },
        { id: 'frontier', difficulty: 'expert' },
      ],
    });
  });

  it('staffs from the implicit tier when global config is on but plan metadata opts out (PAN-2397)', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
      planItem('frontier', { difficulty: 'expert' }),
    ], { tiered_execution: 'off' }));

    expect(resolveSingleWorkTierSpawnParams('/ws')).toEqual({
      ...IMPLICIT_PARAMS,
      planDifficulties: ['expert'],
      planItems: [{ id: 'frontier', difficulty: 'expert' }],
    });
  });

  it('leaves ordinary single work-agent starts untouched when no xBRIEF plan is readable', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(null);

    expect(resolveSingleWorkTierSpawnParams('/ws')).toEqual({});
  });

  it('uses the first dispatchable item and skips completed blockers', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
      planItem('done', { difficulty: 'simple' }, 'completed'),
      planItem('frontier', { difficulty: 'expert' }),
    ]));

    expect(resolveSingleWorkTierSpawnParams('/ws')).toEqual({
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      tierName: 'frontier',
      implicit: false,
      planDifficulties: ['expert'],
      planItems: [{ id: 'frontier', difficulty: 'expert' }],
    });
  });

  it('lets an explicit per-spawn model override outrank single work-agent tier routing (PAN-3842: surfaces difficulty for fitness warn)', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
      planItem('frontier', { difficulty: 'expert' }),
    ]));

    // Override precedence preserved: tier-resolved model/harness stay unset
    // so the spawn path keeps options.model as the FINAL selected model.
    // Plan difficulty info is still surfaced so the caller can warn.
    expect(resolveSingleWorkTierSpawnParams('/ws', 'claude-sonnet-5')).toEqual({
      explicitOverride: 'claude-sonnet-5',
      planDifficulties: ['expert'],
      planItems: [{ id: 'frontier', difficulty: 'expert' }],
    });
  });
});

describe('applyTierAssignment', () => {
  it('carries the resolved model and harness into spawn params over the parent default', () => {
    const assignment = chooseTierAssignment(item({ difficulty: 'expert' }), TIERING);
    const options = applyTierAssignment({ model: 'gpt-5.5', harness: 'codex' as const }, assignment);
    expect(options.model).toBe('claude-opus-4-8');
    expect(options.harness).toBe('claude-code');
  });

  it('passes spawn params through unchanged when no assignment resolved a tier', () => {
    const parent = { model: 'gpt-5.5', harness: 'codex' as const };
    expect(applyTierAssignment(parent, undefined)).toBe(parent);
    expect(applyTierAssignment(parent, { dispatch: 'in-context' })).toBe(parent);
  });
});

describe('spawn-time tier fitness logging (PAN-3842)', () => {
  function planDoc(items: XBriefItem[]): XBriefDocument {
    return {
      xBRIEFInfo: { version: '0.6', created: '2026-07-02T00:00:00Z' },
      plan: { id: 'plan-1', title: 'test plan', status: 'running', items, edges: [] },
    };
  }

  function planItem(id: string, metadata: XBriefItem['metadata']): XBriefItem {
    return { id, title: id, status: 'pending', metadata };
  }

  function mockCatalogConfig(): void {
    vi.mocked(loadConfigSync).mockReturnValue({
      config: { enabledProviders: new Set(['anthropic']), roles: { work: { model: 'claude-sonnet-4-6' } } },
    } as unknown as ReturnType<typeof loadConfigSync>);
  }

  beforeEach(() => {
    vi.mocked(loadConfigSync).mockReset();
    vi.mocked(readWorkspacePlanSync).mockReset();
  });

  it('resolveSlotTierSpawnParams carries the item difficulty into the params', () => {
    mockCatalogConfig();
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([planItem('task-x', { difficulty: 'complex' })]));
    expect(resolveSlotTierSpawnParams('/ws', 'task-x').difficulty).toBe('complex');
  });

  it('logs exactly one [spawn] tier fitness line naming expert and small-class for an expert item on a haiku staffing', () => {
    mockCatalogConfig();
    const lines: string[] = [];
    logTierFitnessAtSpawn('agent-1', { tierName: 'cheap', model: 'claude-haiku-4-5', harness: 'claude-code' }, ['expert'], [{ id: 'task-x', difficulty: 'expert' }], (l) => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith('[spawn] tier fitness:')).toBe(true);
    expect(lines[0]).toContain('expert');
    expect(lines[0]).toContain('small-class');
    expect(lines[0]).toContain('task-x');
  });

  it('logs nothing for the same expert item on a claude-opus-4-8 staffing', () => {
    mockCatalogConfig();
    const lines: string[] = [];
    logTierFitnessAtSpawn('agent-1', { tierName: 'frontier', model: 'claude-opus-4-8', harness: 'claude-code' }, ['expert'], [{ id: 'task-x', difficulty: 'expert' }], (l) => lines.push(l));
    expect(lines).toEqual([]);
  });

  it('logs a skipped line and never throws when the context build fails', () => {
    vi.mocked(loadConfigSync).mockImplementation(() => {
      throw new Error('config exploded');
    });
    const lines: string[] = [];
    expect(() =>
      logTierFitnessAtSpawn('agent-1', { tierName: 'cheap', model: 'claude-haiku-4-5' }, ['expert'], [{ id: 'task-x', difficulty: 'expert' }], (l) => lines.push(l)),
    ).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith('[spawn] tier fitness check skipped:')).toBe(true);
    expect(lines[0]).toContain('config exploded');
  });

  it('skips silently when the staffing has no model or no difficulties', () => {
    mockCatalogConfig();
    const lines: string[] = [];
    logTierFitnessAtSpawn('agent-1', { tierName: 'cheap' }, ['expert'], [{ id: 'task-x', difficulty: 'expert' }], (l) => lines.push(l));
    logTierFitnessAtSpawn('agent-1', { tierName: 'cheap', model: 'claude-haiku-4-5' }, [], [{ id: 'task-x', difficulty: 'expert' }], (l) => lines.push(l));
    expect(lines).toEqual([]);
  });

  describe('single-work plan-max fitness (FR-6)', () => {
    const PAN3836_CONFIG: TierAssignmentConfig = {
      enabled: true,
      tiers: {
        'trivial-simple': { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
        'medium-complex': { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium', 'complex'] },
      },
      difficultyToTier: {
        trivial: 'trivial-simple',
        simple: 'trivial-simple',
        medium: 'medium-complex',
        complex: 'medium-complex',
      },
    };

    function mockPan3836Config(): void {
      vi.mocked(loadConfigSync).mockReturnValue({
        config: { tieredExecution: PAN3836_CONFIG, enabledProviders: new Set(['anthropic']), roles: { work: { model: 'claude-sonnet-4-6' } } },
      } as unknown as ReturnType<typeof loadConfigSync>);
    }

    it('returns every pending item difficulty as planDifficulties when the first item is simple', () => {
      mockPan3836Config();
      vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
        planItem('first', { difficulty: 'simple' }),
        planItem('mid', { difficulty: 'medium' }),
        planItem('hard', { difficulty: 'complex' }),
      ]));
      const params = resolveSingleWorkTierSpawnParams('/ws');
      expect(params.model).toBe('claude-haiku-4-5');
      expect(params.planDifficulties).toEqual(['simple', 'medium', 'complex']);
    });

    it('logs one line naming medium, complex and only the medium/complex item ids for a haiku staffing', () => {
      mockPan3836Config();
      vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
        planItem('first', { difficulty: 'simple' }),
        planItem('mid', { difficulty: 'medium' }),
        planItem('hard', { difficulty: 'complex' }),
      ]));
      const params = resolveSingleWorkTierSpawnParams('/ws');
      const lines: string[] = [];
      logTierFitnessAtSpawn('agent-1', { tierName: params.tierName ?? 'default', model: params.model, harness: params.harness }, params.planDifficulties ?? [], params.planItems ?? [], (l) => lines.push(l));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('medium, complex');
      expect(lines[0]).toContain('mid');
      expect(lines[0]).toContain('hard');
      expect(lines[0]).not.toContain('first');
    });

    it('logs nothing when the first item is complex and staffing resolves to claude-sonnet-5', () => {
      mockPan3836Config();
      vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
        planItem('hard', { difficulty: 'complex' }),
        planItem('first', { difficulty: 'simple' }),
        planItem('mid', { difficulty: 'medium' }),
      ]));
      const params = resolveSingleWorkTierSpawnParams('/ws');
      expect(params.model).toBe('claude-sonnet-5');
      const lines: string[] = [];
      logTierFitnessAtSpawn('agent-1', { tierName: params.tierName ?? 'default', model: params.model, harness: params.harness }, params.planDifficulties ?? [], params.planItems ?? [], (l) => lines.push(l));
      expect(lines).toEqual([]);
    });

    it('returns plan difficulties but no model/harness for an explicit per-spawn model override (PAN-3842)', () => {
      mockPan3836Config();
      vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
        planItem('first', { difficulty: 'simple' }),
        planItem('mid', { difficulty: 'medium' }),
        planItem('hard', { difficulty: 'complex' }),
      ]));
      const params = resolveSingleWorkTierSpawnParams('/ws', 'claude-haiku-4-5');
      // Override precedence preserved: no tier-resolved model/harness so the
      // spawn path keeps options.model as the FINAL selected model.
      expect(params.model).toBeUndefined();
      expect(params.harness).toBeUndefined();
      expect(params.tierName).toBeUndefined();
      expect(params.explicitOverride).toBe('claude-haiku-4-5');
      // Difficulty info is still surfaced so the caller can warn against the
      // FINAL selected (explicit) model.
      expect(params.planDifficulties).toEqual(['simple', 'medium', 'complex']);
      expect(params.planItems?.map((i) => i.id)).toEqual(['first', 'mid', 'hard']);
    });

    it('warns (does not block) when an explicit small model runs an expert plan via the single-work path', () => {
      mockPan3836Config();
      vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
        planItem('first', { difficulty: 'simple' }),
        planItem('hard', { difficulty: 'expert' }),
      ]));
      const params = resolveSingleWorkTierSpawnParams('/ws', 'claude-haiku-4-5');
      // Simulate the spawn caller using the FINAL selected model (the
      // explicit override), which is what determines the fitness verdict.
      const lines: string[] = [];
      logTierFitnessAtSpawn(
        'agent-1',
        { tierName: params.tierName ?? 'default', model: 'claude-haiku-4-5', harness: params.harness },
        params.planDifficulties ?? [],
        params.planItems ?? [],
        (l) => lines.push(l),
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('expert');
      expect(lines[0]).toContain('small-class');
      expect(lines[0]).toContain('hard');
      // Warn, never block: no error is thrown and the spawn proceeds.
    });

    it('does not warn when an explicit model fits every pending item difficulty', () => {
      mockPan3836Config();
      vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
        planItem('first', { difficulty: 'simple' }),
        planItem('mid', { difficulty: 'medium' }),
        planItem('hard', { difficulty: 'complex' }),
      ]));
      // Frontier model explicitly picked for a plan whose hardest item is
      // complex — fitness should not warn.
      const params = resolveSingleWorkTierSpawnParams('/ws', 'claude-opus-4-8');
      const lines: string[] = [];
      logTierFitnessAtSpawn(
        'agent-1',
        { tierName: params.tierName ?? 'default', model: 'claude-opus-4-8', harness: params.harness },
        params.planDifficulties ?? [],
        params.planItems ?? [],
        (l) => lines.push(l),
      );
      expect(lines).toEqual([]);
    });

    it('warns (does not block) when an explicit small model runs an expert slot item', () => {
      mockPan3836Config();
      vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
        planItem('task-x', { difficulty: 'expert' }),
      ]));
      const tierParams = resolveSlotTierSpawnParams('/ws', 'task-x', 'claude-haiku-4-5');
      // Override precedence preserved: no tier-resolved model.
      expect(tierParams.model).toBeUndefined();
      expect(tierParams.explicitOverride).toBe('claude-haiku-4-5');
      // Difficulty is surfaced so the spawn caller can warn.
      expect(tierParams.difficulty).toBe('expert');
      // The spawn caller passes the FINAL selected (explicit) model to the
      // log function; the warning fires without blocking.
      const lines: string[] = [];
      logTierFitnessAtSpawn(
        'agent-slot',
        { tierName: tierParams.tierName ?? 'default', model: 'claude-haiku-4-5', harness: tierParams.harness },
        tierParams.difficulty ? [tierParams.difficulty] : [],
        [{ id: 'task-x', difficulty: tierParams.difficulty }],
        (l) => lines.push(l),
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('expert');
      expect(lines[0]).toContain('small-class');
      expect(lines[0]).toContain('task-x');
    });

    it('does not warn when an explicit frontier model fits an expert slot item', () => {
      mockPan3836Config();
      vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
        planItem('task-x', { difficulty: 'expert' }),
      ]));
      const tierParams = resolveSlotTierSpawnParams('/ws', 'task-x', 'claude-opus-4-8');
      const lines: string[] = [];
      logTierFitnessAtSpawn(
        'agent-slot',
        { tierName: tierParams.tierName ?? 'default', model: 'claude-opus-4-8', harness: tierParams.harness },
        tierParams.difficulty ? [tierParams.difficulty] : [],
        [{ id: 'task-x', difficulty: tierParams.difficulty }],
        (l) => lines.push(l),
      );
      expect(lines).toEqual([]);
    });
  });

  describe('slot spawn wiring (PAN-3842 review fix)', () => {
    // These tests pin the spawn.ts call-site ordering: the staffed model
    // must be COMPUTED before logTierFitnessAtSpawn is called, so the
    // fitness check sees the final selected model — not the pre-staffing
    // parent default. The pre-fix code passed slotModel BEFORE the
    // if (tierParams.model) reassignment and so warned on the wrong model.

    // Mirror the resolveSlotTierSpawnParams + reassignment sequence used by
    // spawn.ts:138-148 so the wiring is exercised, not just the logger.
    function simulateSlotSpawnCallSite(
      tierParams: { tierName?: string; model?: string; harness?: 'claude-code'; difficulty?: 'trivial' | 'simple' | 'medium' | 'complex' | 'expert' },
      optionsModel: string,
      lines: string[],
    ): { slotModel: string; slotHarness: 'claude-code' | undefined } {
      let slotModel = optionsModel; // parent default from determineModel
      let slotHarness: 'claude-code' | undefined;
      if (tierParams.model) {
        // determineModel on the tier-resolved model
        slotModel = tierParams.model;
        slotHarness = tierParams.harness;
      }
      logTierFitnessAtSpawn(
        'agent-slot',
        { tierName: tierParams.tierName ?? 'default', model: slotModel, harness: tierParams.harness ?? slotHarness },
        tierParams.difficulty ? [tierParams.difficulty] : [],
        [{ id: 'task-x', difficulty: tierParams.difficulty }],
        (l) => lines.push(l),
      );
      return { slotModel, slotHarness };
    }

    it('checks the STAFFED model, not the parent default, on a tiered-on expert item', () => {
      // Tiered table staffed opus-4-8 (frontier) on an expert item. Without
      // the fix, the warn would name a parent-default workhorse, not opus.
      mockCatalogConfig();
      const tierParams = {
        tierName: 'frontier',
        model: 'claude-opus-4-8' as const,
        harness: 'claude-code' as const,
        difficulty: 'expert' as const,
      };
      const lines: string[] = [];
      const { slotModel } = simulateSlotSpawnCallSite(tierParams, 'claude-sonnet-4-6', lines);
      // The agent is staffed on opus; the fitness check runs against opus.
      expect(slotModel).toBe('claude-opus-4-8');
      expect(lines).toEqual([]);
    });

    it('does not warn on a tiered-on expert item whose parent default is small', () => {
      // Inverse direction: tiered table picked haiku for an expert item is
      // wrong — that IS a real underpowered warning. This test pins the
      // positive case: when staffing correctly picks opus, no false alarm.
      mockCatalogConfig();
      const tierParams = {
        tierName: 'frontier',
        model: 'claude-opus-4-8' as const,
        harness: 'claude-code' as const,
        difficulty: 'expert' as const,
      };
      const lines: string[] = [];
      simulateSlotSpawnCallSite(tierParams, 'claude-haiku-4-5', lines);
      expect(lines).toEqual([]);
    });

    it('explicit --model slot spawn does NOT throw when the item is missing from the plan', () => {
      // PAN-3842 review fix: the override branch must short-circuit BEFORE
      // the missing-item throw. Otherwise an ordinary slot/plan desync (item
      // renamed or removed) would abort a spawn the operator explicitly
      // chose a model for.
      mockCatalogConfig();
      vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
        planItem('renamed-task', { difficulty: 'expert' }),
      ]));
      const explicitOverride = 'claude-sonnet-5';
      const tierParams = resolveSlotTierSpawnParams('/ws', 'task-x', explicitOverride);
      expect(tierParams.model).toBeUndefined();
      expect(tierParams.explicitOverride).toBe('claude-sonnet-5');
      expect(tierParams.difficulty).toBeUndefined();
      // No throw — and the spawn caller proceeds with the explicit model.
    });

    it('explicit --model slot spawn still surfaces difficulty when the item IS present', () => {
      // Same desync-safe branch, but with a present item: difficulty IS
      // surfaced so the spawn caller can warn against the explicit model.
      mockCatalogConfig();
      vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
        planItem('task-x', { difficulty: 'expert' }),
      ]));
      const tierParams = resolveSlotTierSpawnParams('/ws', 'task-x', 'claude-haiku-4-5');
      expect(tierParams.difficulty).toBe('expert');
      expect(tierParams.explicitOverride).toBe('claude-haiku-4-5');
      // The spawn caller fires the warning using the explicit model.
      const lines: string[] = [];
      simulateSlotSpawnCallSite(
        { ...tierParams, difficulty: tierParams.difficulty },
        'claude-haiku-4-5',
        lines,
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('expert');
      expect(lines[0]).toContain('small-class');
    });
  });
});
