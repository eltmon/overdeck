import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LIST_PATH = fileURLToPath(new URL('../../../scripts/frontend-test-subset.txt', import.meta.url));
const FRONTEND_ROOT = fileURLToPath(new URL('../../../src/dashboard/frontend/', import.meta.url));

function listedPaths(): string[] {
  return readFileSync(LIST_PATH, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

describe('scripts/frontend-test-subset.txt', () => {
  it('is non-empty', () => {
    expect(listedPaths().length).toBeGreaterThan(0);
  });

  it('every listed frontend test file exists', () => {
    const missing = listedPaths().filter((entry) => !existsSync(join(FRONTEND_ROOT, entry)));
    expect(missing).toEqual([]);
  });
});
