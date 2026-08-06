import { describe, expect, it } from 'vitest';
import { mergeConfigs } from '../config-yaml.js';

describe('ui.theme configuration (PAN-3410)', () => {
  it('defaults to broadsheet when unset', () => {
    const { config } = mergeConfigs({});
    expect(config.ui.theme).toBe('broadsheet');
  });

  it('round-trips ledger', () => {
    const { config } = mergeConfigs({ ui: { theme: 'ledger' } });
    expect(config.ui.theme).toBe('ledger');
  });

  it('round-trips broadsheet', () => {
    const { config } = mergeConfigs({ ui: { theme: 'broadsheet' } });
    expect(config.ui.theme).toBe('broadsheet');
  });

  it('throws a loud error naming ui.theme and the allowed values for an invalid value', () => {
    expect(() => mergeConfigs({ ui: { theme: 'neon' as never } })).toThrow(
      'config.yaml: ui.theme must be ledger or broadsheet',
    );
  });
});
