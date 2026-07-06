import { describe, expect, it } from 'vitest';
import { resolvePlanningMode, type PlanningMode } from '../planning-mode.js';

describe('resolvePlanningMode (PAN-2407)', () => {
  it('returns the --plan value when given', () => {
    const result = resolvePlanningMode({ planFlag: 'interactive' });
    expect(result.mode).toBe('interactive');
    expect(result.warnings).toHaveLength(0);
  });

  it('returns skip plus deprecation warning when only legacy --auto is set', () => {
    const result = resolvePlanningMode({ legacyAuto: true });
    expect(result.mode).toBe('skip');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/--auto is deprecated/);
    expect(result.warnings[0]).toMatch(/--plan skip/);
  });

  it('returns the config default when neither flag is set', () => {
    const result = resolvePlanningMode({ configDefault: 'interactive' });
    expect(result.mode).toBe('interactive');
    expect(result.warnings).toHaveLength(0);
  });

  it('returns auto when no flag and no config default are provided', () => {
    const result = resolvePlanningMode({});
    expect(result.mode).toBe('auto');
    expect(result.warnings).toHaveLength(0);
  });

  it('validates all accepted planning modes', () => {
    for (const mode of ['interactive', 'auto', 'skip'] as PlanningMode[]) {
      expect(resolvePlanningMode({ planFlag: mode }).mode).toBe(mode);
      expect(resolvePlanningMode({ configDefault: mode }).mode).toBe(mode);
    }
  });

  it('throws for an invalid --plan value, listing valid values', () => {
    expect(() => resolvePlanningMode({ planFlag: 'fast' })).toThrow(
      /Invalid --plan value: fast.*interactive, auto, skip/,
    );
  });

  it('throws for an invalid config default, naming planning.default_mode and valid values', () => {
    expect(() => resolvePlanningMode({ configDefault: 'banana' })).toThrow(
      /Invalid planning\.default_mode config value: banana.*interactive, auto, skip/,
    );
  });

  it('lets --plan win over --auto and adds a deprecation warning', () => {
    const result = resolvePlanningMode({ planFlag: 'interactive', legacyAuto: true });
    expect(result.mode).toBe('interactive');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/--auto is deprecated/);
    expect(result.warnings[0]).toMatch(/--plan flag takes precedence/);
  });
});
