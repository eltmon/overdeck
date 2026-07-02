import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { VBriefDocument, VBriefItem } from '../../vbrief/types.js';
import {
  assignDispatchTier,
  chooseDispatchTier,
  type DispatchTierAssignmentConfig,
} from '../dispatch-tier.js';
import { ResolveTierError } from '../resolve-tier.js';

vi.mock('../../config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config-yaml.js')>();
  return {
    ...actual,
    loadConfigSync: vi.fn(),
  };
});
vi.mock('../../vbrief/io.js', () => ({
  readWorkspacePlanSync: vi.fn(),
}));

import { loadConfigSync } from '../../config-yaml.js';
import { readWorkspacePlanSync } from '../../vbrief/io.js';
import { resolveSlotTierSpawnParams } from '../spawn-prep.js';

const TIER_CONFIG: DispatchTierAssignmentConfig = {
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

function item(metadata: VBriefItem['metadata'], id = 'item-1'): Pick<VBriefItem, 'id' | 'title' | 'metadata'> {
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
    const candidates: Array<Pick<VBriefItem, 'id' | 'title' | 'metadata'>> = [
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

describe('resolveSlotTierSpawnParams', () => {
  function planDoc(items: VBriefItem[], planMetadata?: Record<string, unknown>): VBriefDocument {
    return {
      vBRIEFInfo: { version: '0.6', created: '2026-07-02T00:00:00Z' },
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

  function planItem(id: string, metadata: VBriefItem['metadata']): VBriefItem {
    return { id, title: id, status: 'pending', metadata };
  }

  function mockConfig(tieredExecution: DispatchTierAssignmentConfig): void {
    vi.mocked(loadConfigSync).mockReturnValue({
      config: { tieredExecution },
    } as unknown as ReturnType<typeof loadConfigSync>);
  }

  beforeEach(() => {
    vi.mocked(loadConfigSync).mockReset();
    vi.mocked(readWorkspacePlanSync).mockReset();
  });

  it('carries the resolved tier model and harness into the spawn params when tiering is on', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([planItem('bead-x', { difficulty: 'expert' })]));

    expect(resolveSlotTierSpawnParams('/ws', 'bead-x')).toEqual({
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      tierName: 'frontier',
    });
  });

  it('returns no override when tiering is disabled', () => {
    mockConfig({ ...TIER_CONFIG, enabled: false });
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([planItem('bead-x', { difficulty: 'expert' })]));

    expect(resolveSlotTierSpawnParams('/ws', 'bead-x')).toEqual({});
  });

  it('lets an explicit per-spawn model override outrank tier routing', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([planItem('bead-x', { difficulty: 'expert' })]));

    expect(resolveSlotTierSpawnParams('/ws', 'bead-x', 'claude-sonnet-5')).toEqual({});
  });

  it('falls through to the existing role-default resolution for an unlabeled item', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([planItem('bead-x', {})]));

    expect(resolveSlotTierSpawnParams('/ws', 'bead-x')).toEqual({});
  });

  it('throws when tiering is enabled but the slot item is missing from the plan', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc([planItem('other', { difficulty: 'medium' })]));

    expect(() => resolveSlotTierSpawnParams('/ws', 'bead-x')).toThrow("item 'bead-x' was not found");
  });

  it('throws when tiering is enabled but no plan is readable', () => {
    mockConfig(TIER_CONFIG);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(null);

    expect(() => resolveSlotTierSpawnParams('/ws', 'bead-x')).toThrow('no vBRIEF plan is readable');
  });
});
