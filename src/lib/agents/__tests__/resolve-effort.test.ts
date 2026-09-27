import { describe, expect, it, vi } from 'vitest';

const modelEffortLevels: Record<string, readonly string[] | undefined> = {
  'high-max-model': ['high', 'max'],
  'max-only-model': ['max'],
  'no-restriction-model': undefined,
};

vi.mock('../../model-capabilities.js', () => ({
  getModelEffortLevels: (model: string) => modelEffortLevels[model],
}));

const { clampEffort, effortConfigErrors, supportedEffortLevels } = await import('../effort-support.js');

describe('effort-support', () => {
  describe('supportedEffortLevels / clampEffort', () => {
    it('keeps a level the harness supports', () => {
      expect(clampEffort('high', undefined, 'ohmypi')).toEqual({ effort: 'high', clamped: false });
    });

    it('clamps a harness-unsupported level down to the highest level below it', () => {
      const result = clampEffort('max', undefined, 'ohmypi');
      expect(result.effort).toBe('xhigh');
      expect(result.clamped).toBe(true);
      expect(result.warning).toBeTruthy();
    });

    it('clamps up to the lowest supported level when nothing ranks below the request', () => {
      const result = clampEffort('low', 'high-max-model');
      expect(result.effort).toBe('high');
      expect(result.clamped).toBe(true);
      expect(result.warning).toBeTruthy();
    });

    it('keeps the requested level with a warning when model and harness restrictions do not overlap', () => {
      // model restricts to {max}, harness (ohmypi) restricts to {low, medium, high, xhigh} -> empty intersection
      const result = clampEffort('max', 'max-only-model', 'ohmypi');
      expect(result.effort).toBe('max');
      expect(result.clamped).toBe(false);
      expect(result.warning).toBeTruthy();
    });

    it('returns all five levels when neither model nor harness restricts', () => {
      expect(supportedEffortLevels()).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
      expect(supportedEffortLevels('no-restriction-model')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    });
  });

  describe('effortConfigErrors', () => {
    it('returns no errors for an undefined effort', () => {
      expect(effortConfigErrors('roles.work', undefined, [])).toEqual([]);
    });

    it('flags a non-canonical effort value', () => {
      expect(effortConfigErrors('roles.work', 'bogus', [])).toEqual([
        'roles.work.effort must be one of low, medium, high, xhigh, max',
      ]);
    });

    it('flags a level the resolved model does not support', () => {
      expect(effortConfigErrors('roles.work', 'max', ['high-max-model'])).toEqual([]);
      expect(effortConfigErrors('roles.work', 'low', ['high-max-model'])).toEqual([
        "roles.work.effort 'low' is not supported by high-max-model (supported: high, max)",
      ]);
    });
  });
});
