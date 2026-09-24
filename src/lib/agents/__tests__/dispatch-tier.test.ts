import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { XBriefDocument, XBriefItem } from '../../xbrief/types.js';
import { type TierAssignmentConfig   } from '../dispatch-tier.js';

vi.mock('../../config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config-yaml.js')>();
  return {
    ...actual,
    loadConfigSync: vi.fn(),
  };
});
vi.mock('../../xbrief/io.js', () => ({
  readWorkspacePlanSync: vi.fn(),
  readTierOverrides: vi.fn(() => ({})),
}));

import { loadConfigSync } from '../../config-yaml.js';
import { readTierOverrides, readWorkspacePlanSync } from '../../xbrief/io.js';
import { logTierFitnessAtSpawn, resolveSingleWorkTierSpawnParams, resolveSlotSpawnFitness, resolveSlotTierSpawnParams  } from '../spawn-prep.js';

// Moved here from src/lib/agents/dispatch-tier.ts, which no production code called (PAN-3958 CH-8).

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

function item(metadata: XBriefItem['metadata'], id = 'item-1'): Pick<XBriefItem, 'id' | 'title' | 'metadata'> {
  return { id, title: 'test item', metadata };
}



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
    vi.mocked(readTierOverrides).mockReturnValue({});
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

  // PAN-3858: a recorded promotion must change the model the slot spawns on.
  it('applies a recorded tier promotion to the slot item before resolving its tier', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([planItem('task-x', { difficulty: 'simple' })]));
    vi.mocked(readTierOverrides).mockReturnValue({
      'task-x': {
        effectiveDifficulty: 'expert',
        promotions: 1,
        history: [{ at: '2026-09-17T00:00:00.000Z', from: 'simple', to: 'expert', reason: 'test' }],
      },
    });

    expect(resolveSlotTierSpawnParams('/ws', 'task-x')).toEqual({
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      tierName: 'frontier',
      implicit: false,
      // PAN-3842 + PAN-3858: fitness judges the model against the SAME
      // (promoted) difficulty staffing routed on, not the authored 'simple'.
      difficulty: 'expert',
    });
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
    vi.mocked(readTierOverrides).mockReturnValue({});
  });

  it('routes tiered when global config is off but plan metadata opts in', () => {
    mockConfig({ ...TIER_CONFIG, enabled: false });
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
      planItem('cheap', { difficulty: 'simple' }),
      planItem('frontier', { difficulty: 'expert' }),
    ], { tiered_execution: 'on' }));

    expect(resolveSingleWorkTierSpawnParams('/ws')).toEqual({
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      tierName: 'frontier',
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

  // PAN-3857 (D4): the single work agent executes the whole plan, so it is
  // staffed for the plan's hardest remaining item — not the first dispatchable
  // one (which misrouted plans whose hard items come later).
  it("keys on the plan's max difficulty, not the first dispatchable item", () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
      planItem('first', { difficulty: 'simple' }),
      planItem('later', { difficulty: 'complex' }),
    ]));

    expect(resolveSingleWorkTierSpawnParams('/ws')).toEqual({
      model: 'claude-sonnet-5',
      harness: 'claude-code',
      tierName: 'standard',
      implicit: false,
      planDifficulties: ['simple', 'complex'],
      planItems: [
        { id: 'first', difficulty: 'simple' },
        { id: 'later', difficulty: 'complex' },
      ],
    });
  });

  it('excludes completed, cancelled, running, and blocked items from the max', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
      planItem('done', { difficulty: 'expert' }, 'completed'),
      planItem('cancelled', { difficulty: 'expert' }, 'cancelled'),
      planItem('running', { difficulty: 'expert' }, 'running'),
      planItem('blocked', { difficulty: 'expert' }, 'blocked'),
      planItem('next', { difficulty: 'simple' }),
    ]));

    expect(resolveSingleWorkTierSpawnParams('/ws')).toEqual({
      model: 'claude-haiku-4-5',
      harness: 'claude-code',
      tierName: 'cheap',
      implicit: false,
      // PAN-3842: the fitness sweep is deliberately WIDER than the staffing
      // candidate set — a running item is what this agent is working and a
      // blocked one unblocks into the same agent, so both difficulties still
      // belong in the warning. Only completed/cancelled work drops out.
      planDifficulties: ['expert', 'simple'],
      planItems: [
        { id: 'running', difficulty: 'expert' },
        { id: 'blocked', difficulty: 'expert' },
        { id: 'next', difficulty: 'simple' },
      ],
    });
  });

  it("applies by_kind per item before taking the max, so a design item counts as its tier's difficulty", () => {
    mockConfig({ ...TIER_CONFIG, byKind: { design: 'standard' } });
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
      planItem('code', { difficulty: 'simple' }),
      planItem('ux', { kind: 'design' }),
    ]));

    expect(resolveSingleWorkTierSpawnParams('/ws')).toEqual({
      model: 'claude-sonnet-5',
      harness: 'claude-code',
      tierName: 'standard',
      implicit: false,
      // 'ux' declares no difficulty of its own, so the fitness sweep has
      // nothing to judge it against and lists only 'code'.
      planDifficulties: ['simple'],
      planItems: [{ id: 'code', difficulty: 'simple' }],
    });
  });

  it("lets by_kind outrank an item's own difficulty, exactly as resolveTier applies it", () => {
    mockConfig({ ...TIER_CONFIG, byKind: { design: 'standard' } });
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
      planItem('ux', { kind: 'design', difficulty: 'trivial' }),
      planItem('code', { difficulty: 'simple' }),
    ]));

    expect(resolveSingleWorkTierSpawnParams('/ws')).toEqual({
      model: 'claude-sonnet-5',
      harness: 'claude-code',
      tierName: 'standard',
      implicit: false,
      // by_kind raises the STAFFING difficulty only; the fitness sweep reports
      // each item's own authored difficulty.
      planDifficulties: ['trivial', 'simple'],
      planItems: [
        { id: 'ux', difficulty: 'trivial' },
        { id: 'code', difficulty: 'simple' },
      ],
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

  // PAN-3858: a promotion raises an item's effective difficulty, which can
  // change WHICH item is the plan's hardest remaining one.
  it('ranks a promoted item by its effective difficulty when picking the staffing item', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
      planItem('promoted', { difficulty: 'medium' }),
      planItem('hard', { difficulty: 'complex' }),
    ]));
    vi.mocked(readTierOverrides).mockReturnValue({
      promoted: {
        effectiveDifficulty: 'expert',
        promotions: 1,
        history: [{ at: '2026-09-17T00:00:00.000Z', from: 'medium', to: 'expert', reason: 'test' }],
      },
    });

    expect(resolveSingleWorkTierSpawnParams('/ws')).toEqual({
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      tierName: 'frontier',
      implicit: false,
      // PAN-3842 + PAN-3858: the promotion reaches the fitness sweep too.
      planDifficulties: ['expert', 'complex'],
      planItems: [
        { id: 'promoted', difficulty: 'expert' },
        { id: 'hard', difficulty: 'complex' },
      ],
    });
  });
});


describe('spawn-time tier fitness logging (PAN-3842)', () => {
  function planDoc(items: XBriefItem[]): XBriefDocument {
    return {
      xBRIEFInfo: { version: '0.6', created: '2026-07-02T00:00:00Z' },
      plan: { id: 'plan-1', title: 'test plan', status: 'running', items, edges: [] },
    };
  }

  function planItem(id: string, metadata: XBriefItem['metadata'], status: XBriefItem['status'] = 'pending'): XBriefItem {
    return { id, title: id, status, metadata };
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

    // PAN-3857 (D4) removed the original source of this unfitness: staffing no
    // longer keys on the first dispatchable item, so a plan led by a simple
    // item now staffs its hardest item instead of haiku. FR-6's remaining
    // claim is narrower but still load-bearing — the fitness sweep reports
    // EVERY pending item, not just the one item staffing keyed on.
    it('reports every pending item difficulty even though staffing keys on the max', () => {
      mockPan3836Config();
      vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
        planItem('first', { difficulty: 'simple' }),
        planItem('mid', { difficulty: 'medium' }),
        planItem('hard', { difficulty: 'complex' }),
      ]));
      const params = resolveSingleWorkTierSpawnParams('/ws');
      // Staffed for 'hard' (complex), not for the leading simple item.
      expect(params.model).toBe('claude-sonnet-5');
      expect(params.planDifficulties).toEqual(['simple', 'medium', 'complex']);
      expect(params.planItems).toEqual([
        { id: 'first', difficulty: 'simple' },
        { id: 'mid', difficulty: 'medium' },
        { id: 'hard', difficulty: 'complex' },
      ]);
    });

    // The surviving non-override way a single-work agent lands on a model that
    // is unfit for work it will actually do: main's staffing pick (PAN-3857)
    // excludes blocked items, but the SAME agent works them once they unblock.
    // The fitness sweep is deliberately wider, so the warning still fires.
    it('warns about a blocked item the staffing pick excluded but this agent will still work', () => {
      mockPan3836Config();
      vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
        planItem('next', { difficulty: 'simple' }),
        planItem('later', { difficulty: 'complex' }, 'blocked'),
      ]));
      const params = resolveSingleWorkTierSpawnParams('/ws');
      // Only 'next' is a staffing candidate, so the agent spawns on haiku.
      expect(params.model).toBe('claude-haiku-4-5');
      const lines: string[] = [];
      logTierFitnessAtSpawn('agent-1', { tierName: params.tierName ?? 'default', model: params.model, harness: params.harness }, params.planDifficulties ?? [], params.planItems ?? [], (l) => lines.push(l));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('complex');
      expect(lines[0]).toContain('later');
      expect(lines[0]).not.toContain('next');
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
    // These tests exercise the production resolveSlotSpawnFitness helper
    // that spawn.ts calls at the slot spawn site. The helper centralizes
    // the model reassignment + harness-fallback logic so the fitness check
    // sees the FINAL selected model — the previous in-test simulator
    // duplicated the intended ordering and stayed green when spawn.ts
    // regressed. Driving the production helper closes that gap.

    it('returns the STAFFED model in the fitness payload (not the parent default) when tierParams.model is set', () => {
      // Tiered table staffed opus-4-8 (frontier) on an expert item. Without
      // the fix, the fitness payload would carry the parent default
      // (claude-sonnet-4-6), producing a spurious underpowered warning.
      const tierParams = {
        tierName: 'frontier',
        model: 'claude-opus-4-8' as const,
        harness: 'claude-code' as const,
        difficulty: 'expert' as 'expert',
      };
      const fitness = resolveSlotSpawnFitness(
        'work' as const,
        'work:PAN-3842',
        tierParams,
        'claude-sonnet-4-6', // parent default
        'claude-code',
        'task-x',
      );
      expect(fitness.staffing.model).toBe('claude-opus-4-8');
      expect(fitness.staffing.harness).toBe('claude-code');
      expect(fitness.difficulties).toEqual(['expert']);
      expect(fitness.items).toEqual([{ id: 'task-x', difficulty: 'expert' }]);
    });

    it('returns the EXPLICIT override in the fitness payload when tierParams.model is undefined', () => {
      // Override precedence preserved: the operator-supplied model wins.
      const tierParams = {
        tierName: 'default' as const,
        difficulty: 'expert' as 'expert',
        explicitOverride: 'claude-haiku-4-5',
      };
      const fitness = resolveSlotSpawnFitness(
        'work' as const,
        'work:PAN-3842',
        tierParams,
        'claude-haiku-4-5',
        undefined,
        'task-x',
      );
      expect(fitness.staffing.model).toBe('claude-haiku-4-5');
      expect(fitness.difficulties).toEqual(['expert']);
    });

    it('fires a fitness warning through the real helper when an explicit small model runs an expert slot item', () => {
      mockCatalogConfig();
      vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
        planItem('task-x', { difficulty: 'expert' }),
      ]));
      const tierParams = resolveSlotTierSpawnParams('/ws', 'task-x', 'claude-haiku-4-5');
      expect(tierParams.explicitOverride).toBe('claude-haiku-4-5');
      expect(tierParams.difficulty).toBe('expert');
      // Production helper drives the payload; the logger receives the
      // FINAL selected model (the explicit override) and warns.
      const fitness = resolveSlotSpawnFitness(
        'work' as const,
        'work:PAN-3842',
        tierParams,
        'claude-haiku-4-5',
        undefined,
        'task-x',
      );
      const lines: string[] = [];
      logTierFitnessAtSpawn('agent-slot', fitness.staffing, fitness.difficulties, fitness.items, (l) => lines.push(l));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('expert');
      expect(lines[0]).toContain('small-class');
      expect(lines[0]).toContain('task-x');
    });

    it('does NOT throw when an explicit --model slot spawn targets an item missing from the plan', () => {
      // PAN-3842 review fix: override short-circuits before the missing-
      // item throw. resolveSlotTierSpawnParams returns { explicitOverride,
      // difficulty? } with no model/harness/tierName, and
      // resolveSlotSpawnFitness builds a payload that does not warn
      // (no difficulty surfaced, no model mismatch).
      mockCatalogConfig();
      vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([
        planItem('renamed-task', { difficulty: 'expert' }),
      ]));
      const tierParams = resolveSlotTierSpawnParams('/ws', 'task-x', 'claude-sonnet-5');
      expect(tierParams.model).toBeUndefined();
      expect(tierParams.explicitOverride).toBe('claude-sonnet-5');
      expect(tierParams.difficulty).toBeUndefined();
      // No throw from the helper; payload carries the explicit model only.
      const fitness = resolveSlotSpawnFitness(
        'work' as const,
        'work:PAN-3842',
        tierParams,
        'claude-sonnet-5',
        undefined,
        'task-x',
      );
      expect(fitness.staffing.model).toBe('claude-sonnet-5');
      expect(fitness.difficulties).toEqual([]);
    });

    it('preserves override precedence end-to-end (tierParams.model undefined + explicit override + parent default present)', () => {
      // The helper MUST NOT return the parent default when an override is
      // active — the operator's explicit choice wins. This pins the
      // "preserve override precedence" property the review asked for.
      const tierParams = {
        tierName: 'default' as const,
        difficulty: 'simple' as 'simple',
        explicitOverride: 'claude-sonnet-5',
      };
      const fitness = resolveSlotSpawnFitness(
        'work' as const,
        'work:PAN-3842',
        tierParams,
        'claude-sonnet-5', // explicit override equals optionsModel
        'claude-code',
        'task-x',
      );
      expect(fitness.staffing.model).toBe('claude-sonnet-5');
      expect(fitness.staffing.model).not.toBe('claude-haiku-4-5'); // not the parent default
    });
  });
});
