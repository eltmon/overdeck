import { describe, expect, it } from 'vitest';

import { checkPrimeAgentVersion, parsePrimeAgentVersion, PRIME_AGENT_SUPPORTED_RANGE_LABEL } from '../compat.js';

describe('Prime Agent compatibility pin (PAN-3668 D14)', () => {
  it('parses the version from `prime-agent --version` output on either stream', () => {
    expect(parsePrimeAgentVersion('\n0.8.0\n')).toBe('0.8.0');
    expect(parsePrimeAgentVersion('prime-agent v0.8.3\n')).toBe('0.8.3');
    expect(parsePrimeAgentVersion('no version here')).toBeNull();
  });

  it.each(['0.8.0', '0.8.9', '0.8.1-beta.2'])('accepts %s', (version) => {
    expect(checkPrimeAgentVersion(`${version}\n`)).toEqual({ ok: true, version });
  });

  it.each(['0.7.2', '0.9.0', '1.0.0'])('refuses %s, naming the found version and the range', (version) => {
    const result = checkPrimeAgentVersion(`${version}\n`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(`Prime Agent ${version} is outside the supported range ${PRIME_AGENT_SUPPORTED_RANGE_LABEL}`);
    expect(result.message).toContain('npm install -g prime-agent@0.8');
  });

  it('refuses unreadable output with the supported range', () => {
    const result = checkPrimeAgentVersion('');
    expect(result).toMatchObject({ ok: false, version: null });
    if (!result.ok) expect(result.message).toContain('0.8.0 – <0.9.0');
  });
});
