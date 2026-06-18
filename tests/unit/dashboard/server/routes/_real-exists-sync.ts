// Helper that returns the REAL existsSync, bypassing any vi.mock on node:fs.
// vi.mock('node:fs') replaces the module exports; vi.importActual reaches
// through to the original. This lets a smart test mock delegate specific
// paths to the un-mocked fs without recursing into the mock.

import { vi } from 'vitest';

let cached: ((path: string) => boolean) | null = null;

export async function getRealExistsSync(): Promise<(path: string) => boolean> {
  if (cached) return cached;
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  cached = (path: string) => actual.existsSync(path);
  return cached;
}
