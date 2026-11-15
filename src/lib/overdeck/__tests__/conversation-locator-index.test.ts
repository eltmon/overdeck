import { afterAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// OVERDECK_HOME is captured when infra.js loads, so set it before the first
// dynamic import of the overdeck modules.
const TEST_HOME = join(tmpdir(), `locator-index-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

const { getOverdeckDatabase, closeOverdeckDatabase } = await import('../infra.js');

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

function hasLocatorIndex(): boolean {
  const row = getOverdeckDatabase()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'conv_files_locator_idx'")
    .get();
  return row !== undefined;
}

describe('conv_files_locator_idx', () => {
  it('exists on a fresh database', () => {
    expect(hasLocatorIndex()).toBe(true);
  });

  it('is recreated by the top-up after being dropped and the database reopened', () => {
    getOverdeckDatabase().prepare('DROP INDEX `conv_files_locator_idx`').run();
    expect(hasLocatorIndex()).toBe(false);

    closeOverdeckDatabase();
    expect(hasLocatorIndex()).toBe(true);
  });
});
