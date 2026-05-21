import { join } from 'path';
import { describe, expect } from '@effect/vitest';
import { it } from '@effect/vitest';
import { Effect } from 'effect';
import { resolvePackageRootForDir } from '../paths.js';

describe('resolvePackageRootForDir', () => {
  it.effect('resolves source module paths to the repository root', () =>
    Effect.sync(() => {
      expect(resolvePackageRootForDir(join('/repo', 'src', 'lib'))).toBe('/repo');
    })
  );

  it.effect('resolves bundled CLI paths to the repository root', () =>
    Effect.sync(() => {
      expect(resolvePackageRootForDir(join('/repo', 'dist', 'cli'))).toBe('/repo');
    })
  );

  it.effect('resolves bundled dashboard paths to the repository root', () =>
    Effect.sync(() => {
      expect(resolvePackageRootForDir(join('/repo', 'dist', 'dashboard'))).toBe('/repo');
    })
  );

  it.effect('resolves unbundled dist lib paths to the repository root', () =>
    Effect.sync(() => {
      expect(resolvePackageRootForDir(join('/repo', 'dist', 'lib'))).toBe('/repo');
    })
  );
});
