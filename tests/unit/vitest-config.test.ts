import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const CONFIG_PATH = '../../../vitest.config.ts';

describe('vitest.config.ts flake policy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadConfig(): Promise<{ test: { retry: number; include: string[]; exclude: string[]; maxWorkers: number } }> {
    const mod = await import(CONFIG_PATH);
    return mod.default;
  }

  it('defaults to retry:0 and does not exclude quarantined tests in local dev', async () => {
    vi.stubEnv('CI', undefined);
    vi.stubEnv('OVERDECK_VERIFICATION', undefined);
    vi.stubEnv('OVERDECK_FLAKE_LANE', undefined);

    const config = await loadConfig();

    expect(config.test.retry).toBe(0);
    expect(config.test.exclude).not.toContain('tests/playwright/conversation-supervisor-uat.test.ts');
    expect(config.test.exclude).not.toContain('src/lib/vbrief/__tests__/create-beads.test.ts');
    expect(config.test.include).toContain('tests/**/*.test.ts');
    expect(config.test.maxWorkers).toBe(4);
  });

  it('sets retry:1 in CI and excludes quarantined tests', async () => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('OVERDECK_VERIFICATION', undefined);
    vi.stubEnv('OVERDECK_FLAKE_LANE', undefined);

    const config = await loadConfig();

    expect(config.test.retry).toBe(1);
    expect(config.test.exclude).toContain('tests/playwright/conversation-supervisor-uat.test.ts');
    expect(config.test.exclude).toContain('src/lib/vbrief/__tests__/create-beads.test.ts');
    expect(config.test.maxWorkers).toBe(2);
  });

  it('sets retry:1 in verification mode, excludes quarantined tests, and preserves local fork count', async () => {
    vi.stubEnv('CI', undefined);
    vi.stubEnv('OVERDECK_VERIFICATION', '1');
    vi.stubEnv('OVERDECK_FLAKE_LANE', undefined);

    const config = await loadConfig();

    expect(config.test.retry).toBe(1);
    expect(config.test.exclude).toContain('tests/playwright/conversation-supervisor-uat.test.ts');
    expect(config.test.exclude).toContain('src/lib/vbrief/__tests__/create-beads.test.ts');
    expect(config.test.maxWorkers).toBe(4);
  });

  it('flake-lane mode sets retry:1 and does not exclude quarantined tests', async () => {
    vi.stubEnv('CI', undefined);
    vi.stubEnv('OVERDECK_VERIFICATION', undefined);
    vi.stubEnv('OVERDECK_FLAKE_LANE', '1');

    const config = await loadConfig();

    expect(config.test.retry).toBe(1);
    expect(config.test.exclude).not.toContain('tests/playwright/conversation-supervisor-uat.test.ts');
    expect(config.test.exclude).not.toContain('src/lib/vbrief/__tests__/create-beads.test.ts');
  });
});
