/**
 * PAN-4223 WI-4: the optional `projects.<key>.gauntlet` block and its validator.
 * Defaults (lanes_root, base_ref) belong to resolveLaneConfig, not here.
 */
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { validateGauntletConfig } from '../projects.js';

// The lexerra example documented in configuration/projects.mdx.
const LEXERRA_EXAMPLE = `
lexerra:
  gauntlet:
    lanes_root: /home/eltmon/Projects/lexerra-lanes
    sparse_checkout: ['/*', '!/client/assets-src/*', '/client/assets-src/KayKit_Medieval_Hexagon/']
    roles:
      builder: { model: stealth/space-bunny-alpha }
      critic: { model: claude-opus-5-5, effort: high }
`;

function errorsFor(raw: unknown): string[] {
  const result = validateGauntletConfig(raw);
  return result.ok ? [] : result.errors;
}

describe('validateGauntletConfig', () => {
  it('accepts the documented lexerra example', () => {
    const raw = (parseYaml(LEXERRA_EXAMPLE) as { lexerra: { gauntlet: unknown } }).lexerra.gauntlet;
    const result = validateGauntletConfig(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.roles?.critic).toEqual({ model: 'claude-opus-5-5', effort: 'high' });
      expect(result.config.sparse_checkout).toHaveLength(3);
    }
  });

  it('accepts an empty block (every field is optional)', () => {
    expect(validateGauntletConfig({}).ok).toBe(true);
  });

  it('rejects a relative lanes_root with an error naming lanes_root', () => {
    const errors = errorsFor({ lanes_root: 'Projects/lexerra-lanes' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('lanes_root');
  });

  it('rejects an unknown role with an error naming the role', () => {
    const errors = errorsFor({ roles: { reviewer: { model: 'claude-opus-5-5' } } });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('reviewer');
  });

  it('rejects sparse_checkout that is not an array of non-empty strings', () => {
    expect(errorsFor({ sparse_checkout: '/*' })[0]).toContain('sparse_checkout');
    expect(errorsFor({ sparse_checkout: ['/*', ''] })).toEqual(['gauntlet.sparse_checkout[1] must be a non-empty string']);
    expect(errorsFor({ sparse_checkout: ['/*', 3] })).toEqual(['gauntlet.sparse_checkout[1] must be a non-empty string']);
  });

  it('rejects non-string role fields and a non-object block', () => {
    expect(errorsFor({ roles: { builder: { model: 42 } } })).toEqual(['gauntlet.roles.builder.model must be a non-empty string']);
    expect(errorsFor({ roles: { critic: 'opus' } })).toEqual(['gauntlet.roles.critic must be an object']);
    expect(errorsFor(['lanes_root'])).toEqual(['gauntlet must be an object']);
  });
});
