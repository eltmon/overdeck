import { describe, expect, it } from 'vitest';

import { mergeConfigs, stripProjectSecurity } from '../../config-yaml.js';

describe('config-yaml computer_use block (PAN-5452)', () => {
  it('defaults to disabled', () => {
    const { config } = mergeConfigs(null);
    expect(config.computerUse).toEqual({ enabled: false });
  });

  it('enables via a global layer', () => {
    const { config } = mergeConfigs({ computer_use: { enabled: true } });
    expect(config.computerUse.enabled).toBe(true);
  });

  it('throws on a non-boolean enabled value', () => {
    expect(() =>
      // @ts-expect-error — exercising runtime validation of bad input
      mergeConfigs({ computer_use: { enabled: 'yes' } }),
    ).toThrow(/computer_use\.enabled must be true or false/);
  });

  it('throws when computer_use is not a mapping', () => {
    // @ts-expect-error — exercising runtime validation of bad input
    expect(() => mergeConfigs({ computer_use: [] })).toThrow(/computer_use must be a mapping/);
  });

  it('a project-layer computer_use is stripped by stripProjectSecurity (FR-3, D-3)', () => {
    const stripped = stripProjectSecurity({ computer_use: { enabled: true }, jev: {} });
    expect(stripped).toEqual({ jev: {} });

    const { config } = mergeConfigs(stripped);
    expect(config.computerUse.enabled).toBe(false);
  });
});
