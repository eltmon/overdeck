import { describe, expect, it } from 'vitest';

import {
  JEV_ZEN_BASE_URL,
  jevToggleProblems,
  routeForBaseUrl,
  validateJevSettingsInput,
} from '../settings-validation.js';

describe('routeForBaseUrl (PAN-4508)', () => {
  it('classifies absent, zen (with or without trailing slash), and custom base_urls', () => {
    expect(routeForBaseUrl(undefined)).toBe('direct');
    expect(routeForBaseUrl(JEV_ZEN_BASE_URL)).toBe('zen');
    expect(routeForBaseUrl(`${JEV_ZEN_BASE_URL}/`)).toBe('zen');
    expect(routeForBaseUrl('https://example.test/jev')).toBe('custom');
  });
});

describe('validateJevSettingsInput (PAN-4508)', () => {
  it('requires a model while a Jev feature is on', () => {
    const result = validateJevSettingsInput(
      { route: 'direct', model: '', timeoutMs: 2000 },
      { features: { jevTurnEndAssessment: true } },
    );
    expect(result).toEqual({ ok: false, errors: ['jev.model is required while a Jev feature is on'] });
  });

  it.each([0, 30001, 1.5])('rejects an out-of-range or non-integer timeoutMs %s', (timeoutMs) => {
    const result = validateJevSettingsInput({ route: 'direct', model: 'm', timeoutMs }, {});
    expect(result).toEqual({ ok: false, errors: ['jev.timeout_ms must be an integer between 1 and 30000'] });
  });

  it('rejects route custom when no custom base_url is currently set', () => {
    const result = validateJevSettingsInput({ route: 'custom', model: 'm', timeoutMs: 2000 }, {});
    expect(result).toEqual({
      ok: false,
      errors: ['route custom keeps an existing custom base_url; none is set'],
    });
  });

  it('rejects an unrecognized route', () => {
    const result = validateJevSettingsInput({ route: 'bogus', model: 'm', timeoutMs: 2000 }, {});
    expect(result).toEqual({ ok: false, errors: ['route must be zen, direct, or custom'] });
  });

  it('accepts route custom when a custom base_url is already set', () => {
    const result = validateJevSettingsInput(
      { route: 'custom', model: 'm', timeoutMs: 2000 },
      { baseUrl: 'https://example.test/jev' },
    );
    expect(result).toEqual({ ok: true, value: { route: 'custom', model: 'm', timeoutMs: 2000 } });
  });

  it('collects every applicable error at once', () => {
    const result = validateJevSettingsInput(
      { route: 'bogus', model: '', timeoutMs: 0 },
      { features: { jevMemoryRelevance: true } },
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        'route must be zen, direct, or custom',
        'jev.model is required while a Jev feature is on',
        'jev.timeout_ms must be an integer between 1 and 30000',
      ],
    });
  });

  it('returns ok:true with the model trimmed', () => {
    const result = validateJevSettingsInput({ route: 'zen', model: '  jev-latest  ', timeoutMs: 2000 }, {});
    expect(result).toEqual({ ok: true, value: { route: 'zen', model: 'jev-latest', timeoutMs: 2000 } });
  });
});

describe('jevToggleProblems (PAN-4508)', () => {
  it('errors when a toggle goes off to on with a blank current model', () => {
    const problems = jevToggleProblems({ jevTurnEndAssessment: true }, { features: { jevTurnEndAssessment: false } });
    expect(problems).toEqual([
      {
        key: 'jevTurnEndAssessment',
        level: 'error',
        message: 'Set a Jev model in Settings → Background AI before turning on jevTurnEndAssessment',
      },
    ]);
  });

  it('warns instead of erroring when the toggle is already on in current', () => {
    const problems = jevToggleProblems({ jevTurnEndAssessment: true }, { features: { jevTurnEndAssessment: true } });
    expect(problems).toEqual([
      {
        key: 'jevTurnEndAssessment',
        level: 'warning',
        message: 'jevTurnEndAssessment is on but jev.model is not set; Jev makes no requests until a model is set',
      },
    ]);
  });

  it('returns no problems when current is undefined and no Jev toggle is on in next', () => {
    expect(jevToggleProblems({}, undefined)).toEqual([]);
  });

  it('returns no problems when a model is already set', () => {
    expect(jevToggleProblems({ jevTurnEndAssessment: true }, { model: 'jev-latest' })).toEqual([]);
  });
});
