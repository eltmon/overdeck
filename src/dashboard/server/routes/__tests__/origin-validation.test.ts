import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetTrustedOriginsForTests, getTrustedOrigins } from '../origin-validation.js';

const ORIGIN_ENV_KEYS = [
  'OVERDECK_TRAEFIK_ENABLED',
  'OVERDECK_TRAEFIK_DOMAIN',
  'TRAEFIK_DOMAIN',
  'OVERDECK_TRUSTED_ORIGINS',
  'DASHBOARD_URL',
  'OVERDECK_HOME',
] as const;

describe('getTrustedOrigins', () => {
  let savedEnv: Record<string, string | undefined>;
  let tempDirs: string[];

  function makeHome(configYaml?: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'origin-validation-test-'));
    tempDirs.push(dir);
    if (configYaml !== undefined) {
      writeFileSync(join(dir, 'config.yaml'), configYaml, 'utf8');
    }
    process.env['OVERDECK_HOME'] = dir;
    return dir;
  }

  beforeEach(() => {
    savedEnv = {};
    tempDirs = [];
    for (const key of ORIGIN_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    _resetTrustedOriginsForTests();
  });

  afterEach(() => {
    for (const key of ORIGIN_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    _resetTrustedOriginsForTests();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('always trusts loopback origins', () => {
    makeHome();
    const origins = getTrustedOrigins();
    expect(origins).toContain('http://localhost:3011');
    expect(origins).toContain('http://127.0.0.1:3011');
  });

  it('trusts the env-provided traefik domain when enabled via env', () => {
    makeHome('traefik:\n  enabled: true\n  domain: yaml-domain.localhost\n');
    process.env['OVERDECK_TRAEFIK_ENABLED'] = '1';
    process.env['OVERDECK_TRAEFIK_DOMAIN'] = 'env-domain.localhost';
    const origins = getTrustedOrigins();
    expect(origins).toContain('https://env-domain.localhost');
    expect(origins).not.toContain('https://yaml-domain.localhost');
  });

  it('falls back to config.yaml when no origin env is present (bare launch)', () => {
    makeHome('traefik:\n  enabled: true\n  domain: overdeck.localhost\n');
    expect(getTrustedOrigins()).toContain('https://overdeck.localhost');
  });

  it('does not fall back when config.yaml has traefik disabled', () => {
    makeHome('traefik:\n  enabled: false\n  domain: overdeck.localhost\n');
    expect(getTrustedOrigins()).not.toContain('https://overdeck.localhost');
  });

  it('does not fall back when config.yaml is missing', () => {
    makeHome();
    expect(getTrustedOrigins()).not.toContain('https://overdeck.localhost');
  });

  it('does not fall back when config.yaml is invalid', () => {
    makeHome('traefik: [this is not: valid yaml');
    expect(() => getTrustedOrigins()).not.toThrow();
    expect(getTrustedOrigins()).not.toContain('https://overdeck.localhost');
  });

  it('an explicit env disable wins over an enabled config.yaml', () => {
    makeHome('traefik:\n  enabled: true\n  domain: overdeck.localhost\n');
    process.env['OVERDECK_TRAEFIK_ENABLED'] = '0';
    expect(getTrustedOrigins()).not.toContain('https://overdeck.localhost');
  });

  it('explicit OVERDECK_TRUSTED_ORIGINS wins over the config.yaml fallback', () => {
    makeHome('traefik:\n  enabled: true\n  domain: overdeck.localhost\n');
    process.env['OVERDECK_TRUSTED_ORIGINS'] = 'https://foo.example';
    const origins = getTrustedOrigins();
    expect(origins).toContain('https://foo.example');
    expect(origins).not.toContain('https://overdeck.localhost');
  });
});
