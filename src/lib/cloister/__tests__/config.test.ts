import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  PANOPTICON_HOME: '/tmp/test-panopticon',
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((path: string) => String(path) !== '/tmp/test-panopticon/cloister.toml'),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

import { loadCloisterConfig } from '../config.js';

describe('loadCloisterConfig', () => {
  afterEach(() => {
    delete process.env.PAN_STASH_JANITOR_CYCLES;
  });

  it('accepts PAN_STASH_JANITOR_CYCLES=0 as a valid override', () => {
    process.env.PAN_STASH_JANITOR_CYCLES = '0';

    const config = loadCloisterConfig();

    expect(config.monitoring.stash_janitor_every_cycles).toBe(0);
  });
});
