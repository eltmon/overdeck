import { describe, expect, it } from 'vitest';

import { mergeConfigs, stripProjectSecurity } from '../../config-yaml.js';

describe('config-yaml project-layer security strip (PAN-4585 FR-11)', () => {
  it('removes security but keeps other keys', () => {
    expect(
      stripProjectSecurity({ security: { semgrep: { enabled: true } }, jev: {} }),
    ).toEqual({ jev: {} });
  });

  it('returns null unchanged', () => {
    expect(stripProjectSecurity(null)).toBeNull();
  });

  it('cannot be used to force-disable a global-layer enable', () => {
    const { config } = mergeConfigs(
      stripProjectSecurity({ security: { semgrep: { enabled: false } } }),
      { security: { semgrep: { enabled: true } } },
    );
    expect(config.security.semgrep.enabled).toBe(true);
  });
});
