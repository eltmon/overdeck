import { describe, expect, it } from 'vitest';

import type { XBriefDifficulty } from '../../xbrief/types.js';
import type { ModelCapabilityClass } from '../../model-capability-class.js';
import {
  CAPABILITY_CLASS_RANK,
  DIFFICULTY_CLASS_BANDS,
  checkStaffingFitness,
  checkTierFitness,
  type TierFitnessConfig,
  type TierFitnessContext,
} from '../tier-fitness.js';

/** Literal test catalog — never the real one (PRD WI-2). */
const CLASSES: Record<string, ModelCapabilityClass | undefined> = {
  'big-model': 'frontier',
  'mid-model': 'workhorse',
  'tiny-model': 'small',
  'mystery-model': undefined, // catalogued but unclassified
};
const PROVIDERS: Record<string, string> = {
  'big-model': 'bigco',
  'mid-model': 'midco',
  'tiny-model': 'tinyco',
  'mystery-model': 'mysteryco',
};

function makeCtx(overrides: Partial<TierFitnessContext> = {}): TierFitnessContext {
  return {
    knownModelIds: new Set(Object.keys(CLASSES)),
    classOf: (m) => CLASSES[m],
    providerOf: (m) => PROVIDERS[m],
    ...overrides,
  };
}

function tier(model: string, difficulties: XBriefDifficulty[], extra: Record<string, unknown> = {}) {
  return { model, difficulties, ...extra };
}

describe('band constants', () => {
  it('ranks small < workhorse < frontier and bands match PRD 5.2', () => {
    expect(CAPABILITY_CLASS_RANK).toEqual({ small: 0, workhorse: 1, frontier: 2 });
    expect(DIFFICULTY_CLASS_BANDS.trivial).toEqual({ min: 'small', max: 'workhorse' });
    expect(DIFFICULTY_CLASS_BANDS.expert).toEqual({ min: 'frontier', max: 'frontier' });
  });
});

describe('checkTierFitness', () => {
  it('flags an expert tier on a small-class model as underpowered naming expert', () => {
    const config: TierFitnessConfig = { tiers: { 'expert-tier': tier('tiny-model', ['expert']) } };
    const warnings = checkTierFitness(config, makeCtx());
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('underpowered');
    expect(warnings[0].difficulties).toEqual(['expert']);
    expect(warnings[0].path).toBe('tiered_execution.tiers.expert-tier');
    expect(warnings[0].message.startsWith('tiered_execution.tiers.')).toBe(true);
    expect(warnings[0].message).toContain('frontier-class');
  });

  it('flags a trivial+simple tier on a frontier model as overpowered', () => {
    const config: TierFitnessConfig = { tiers: { cheap: tier('big-model', ['trivial', 'simple']) } };
    const warnings = checkTierFitness(config, makeCtx());
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('overpowered');
    expect(warnings[0].message).toContain('workhorse-class model would cost less');
  });

  it('returns no warning when the same frontier tier also owns medium', () => {
    const config: TierFitnessConfig = { tiers: { cheap: tier('big-model', ['trivial', 'simple', 'medium']) } };
    expect(checkTierFitness(config, makeCtx())).toEqual([]);
  });

  it('flags a medium tier on a small-class model as underpowered', () => {
    const config: TierFitnessConfig = { tiers: { mid: tier('tiny-model', ['medium']) } };
    const warnings = checkTierFitness(config, makeCtx());
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('underpowered');
    expect(warnings[0].difficulties).toEqual(['medium']);
  });

  it('flags only the small entry of a distribution tier owning complex', () => {
    const config: TierFitnessConfig = {
      tiers: {
        mixed: tier('big-model', ['complex'], {
          distribution: [
            { model: 'big-model', weight: 60 },
            { model: 'tiny-model', weight: 40 },
          ],
        }),
      },
    };
    const warnings = checkTierFitness(config, makeCtx());
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('underpowered');
    expect(warnings[0].model).toBe('tiny-model');
    expect(warnings[0].difficulties).toEqual(['complex']);
  });

  it('returns only unknown-model for a model absent from knownModelIds, no band warning', () => {
    const config: TierFitnessConfig = { tiers: { expert: tier('ghost-model', ['expert']) } };
    const warnings = checkTierFitness(config, makeCtx());
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('unknown-model');
    expect(warnings[0].message).toBe('tiered_execution.tiers.expert: ghost-model is not in the model catalog');
  });

  it('flags provider-not-enabled when enabledProviders lacks the provider', () => {
    const config: TierFitnessConfig = { tiers: { mid: tier('mid-model', ['medium']) } };
    const warnings = checkTierFitness(config, makeCtx({ enabledProviders: new Set(['bigco']) }));
    expect(warnings.map((w) => w.code)).toEqual(['provider-not-enabled']);
    expect(warnings[0].message).toContain("provider 'midco'");
  });

  it('skips the provider check when enabledProviders is undefined', () => {
    const config: TierFitnessConfig = { tiers: { mid: tier('mid-model', ['medium']) } };
    expect(checkTierFitness(config, makeCtx())).toEqual([]);
  });

  it('returns no warning for an unclassified model in knownModelIds', () => {
    const config: TierFitnessConfig = { tiers: { mid: tier('mystery-model', ['medium']) } };
    expect(checkTierFitness(config, makeCtx())).toEqual([]);
  });

  it('flags a small-class supervisor as supervisor-underpowered', () => {
    const config: TierFitnessConfig = {
      tiers: { mid: tier('mid-model', ['medium']) },
      supervisor: { model: 'tiny-model' },
    };
    const warnings = checkTierFitness(config, makeCtx());
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('supervisor-underpowered');
    expect(warnings[0].path).toBe('tiered_execution.supervisor');
    expect(warnings[0].message).toContain('should be workhorse-class or better');
  });

  it('emits tier warnings in Object.entries order, then supervisor', () => {
    const config: TierFitnessConfig = {
      tiers: {
        aaa: tier('tiny-model', ['expert']),
        zzz: tier('tiny-model', ['expert']),
      },
      supervisor: { model: 'tiny-model' },
    };
    const warnings = checkTierFitness(config, makeCtx());
    expect(warnings.map((w) => w.path)).toEqual([
      'tiered_execution.tiers.aaa',
      'tiered_execution.tiers.zzz',
      'tiered_execution.supervisor',
    ]);
  });

  it('starts every message with its path', () => {
    const config: TierFitnessConfig = {
      tiers: {
        a: tier('ghost-model', ['expert']),
        b: tier('tiny-model', ['expert']),
        c: tier('big-model', ['trivial']),
      },
      supervisor: { model: 'tiny-model' },
    };
    for (const w of checkTierFitness(config, makeCtx())) {
      expect(w.message.startsWith(w.path), `${w.code} message must start with ${w.path}`).toBe(true);
    }
  });
});

describe('checkStaffingFitness', () => {
  it('returns underpowered listing only the offending difficulties', () => {
    const warnings = checkStaffingFitness(
      { tierName: 'staff', model: 'tiny-model' },
      ['simple', 'complex'],
      makeCtx(),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('underpowered');
    expect(warnings[0].difficulties).toEqual(['complex']);
  });

  it('returns unknown-model for an uncatalogued model', () => {
    const warnings = checkStaffingFitness({ tierName: 'staff', model: 'ghost-model' }, ['expert'], makeCtx());
    expect(warnings.map((w) => w.code)).toEqual(['unknown-model']);
  });

  it('returns provider-not-enabled when the provider is disabled', () => {
    const warnings = checkStaffingFitness(
      { tierName: 'staff', model: 'mid-model' },
      ['medium'],
      makeCtx({ enabledProviders: new Set(['bigco']) }),
    );
    expect(warnings.map((w) => w.code)).toEqual(['provider-not-enabled']);
  });

  it('honors a custom path and defaults to tiered_execution.tiers.<name>', () => {
    const custom = checkStaffingFitness({ tierName: 'default', model: 'tiny-model', path: 'roles.work.model' }, ['expert'], makeCtx());
    expect(custom[0].path).toBe('roles.work.model');
    const fallback = checkStaffingFitness({ tierName: 'default', model: 'tiny-model' }, ['expert'], makeCtx());
    expect(fallback[0].path).toBe('tiered_execution.tiers.default');
  });
});

// PAN-3842 (adjudicated F-5/C1): a single max-requirement clause after a mixed
// list read as though every listed difficulty needed the strongest class.
describe('underpowered wording across mixed difficulties', () => {
  it('states each requirement separately, strongest first, when they differ', () => {
    const [warning] = checkStaffingFitness({ tierName: 'cheap', model: 'tiny-model' }, ['medium', 'complex', 'expert'], makeCtx());
    expect(warning.code).toBe('underpowered');
    expect(warning.message).toContain('expert needs at least frontier-class');
    expect(warning.message).toContain('medium, complex need at least workhorse-class');
    // The old template would have claimed frontier for medium and complex too.
    expect(warning.message).not.toContain('medium, complex, expert — items at that difficulty need at least frontier-class');
  });

  it('never tells the operator that medium requires frontier-class', () => {
    const [warning] = checkStaffingFitness({ tierName: 'cheap', model: 'tiny-model' }, ['medium', 'expert'], makeCtx());
    const mediumClause = warning.message.split('; ').find((clause) => clause.startsWith('medium '));
    expect(mediumClause).toBe('medium needs at least workhorse-class');
  });

  it('keeps the original single-requirement sentence verbatim', () => {
    const [warning] = checkStaffingFitness({ tierName: 'cheap', model: 'tiny-model' }, ['medium', 'complex'], makeCtx());
    expect(warning.message).toBe(
      'tiered_execution.tiers.cheap: tiny-model is a small-class model but this tier owns medium, complex — items at that difficulty need at least workhorse-class',
    );
  });

  it('still fires on the maximum requirement — classification is unchanged', () => {
    const mixed = checkStaffingFitness({ tierName: 'mid', model: 'mid-model' }, ['medium', 'expert'], makeCtx());
    expect(mixed.map((w) => w.code)).toEqual(['underpowered']);
    // A workhorse only fails 'expert', so only that group is named.
    expect(mixed[0].difficulties).toEqual(['expert']);
    expect(mixed[0].message).toContain('items at that difficulty need at least frontier-class');
  });
});
