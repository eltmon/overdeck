/**
 * PAN-4363: `pan doctor` reports the Codex per-model client-version floor
 * (gpt-6-sol/gpt-6-luna under ChatGPT sign-in).
 */
import { describe, expect, it } from 'vitest';

import { checkCodexModelFloors } from '../../../src/cli/commands/doctor-codex-models.js';

const binary = async () => '/usr/local/bin/codex';

describe('checkCodexModelFloors (PAN-4363)', () => {
  it('returns no rows when the Codex CLI is not installed', async () => {
    await expect(checkCodexModelFloors({ resolveBinary: async () => null })).resolves.toEqual([]);
  });

  it('warns for both floored models when the installed version is below the floor', async () => {
    const results = await checkCodexModelFloors({
      resolveBinary: binary,
      readVersion: async () => '0.153.4',
      authMode: async () => 'subscription',
    });
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.status).toBe('warn');
      expect(result.fix).toBe('Upgrade: npm install -g @openai/codex');
    }
    expect(results.map(r => r.message).join('\n')).toContain('gpt-6-sol');
    expect(results.map(r => r.message).join('\n')).toContain('gpt-6-luna');
    expect(results.map(r => r.message).join('\n')).toContain('0.156.1');
  });

  it('is ok for both floored models at or above the floor', async () => {
    const results = await checkCodexModelFloors({
      resolveBinary: binary,
      readVersion: async () => '0.158.0',
      authMode: async () => 'subscription',
    });
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.status).toBe('ok');
    }
  });

  it('is ok for api-key auth regardless of installed version', async () => {
    const results = await checkCodexModelFloors({
      resolveBinary: binary,
      readVersion: async () => '0.153.4',
      authMode: async () => 'api-key',
    });
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.status).toBe('ok');
      expect(result.message).toContain('API-key auth, no client-version floor');
    }
  });

  it('warns with "version unknown" when the version cannot be read', async () => {
    const results = await checkCodexModelFloors({
      resolveBinary: binary,
      readVersion: async () => undefined,
      authMode: async () => 'subscription',
    });
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.status).toBe('warn');
      expect(result.message).toContain('version unknown');
    }
  });
});
