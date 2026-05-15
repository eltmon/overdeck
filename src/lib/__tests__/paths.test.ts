import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { resolvePackageRootForDir } from '../paths.js';

describe('resolvePackageRootForDir', () => {
  it('resolves source module paths to the repository root', () => {
    expect(resolvePackageRootForDir(join('/repo', 'src', 'lib'))).toBe('/repo');
  });

  it('resolves bundled CLI paths to the repository root', () => {
    expect(resolvePackageRootForDir(join('/repo', 'dist', 'cli'))).toBe('/repo');
  });

  it('resolves bundled dashboard paths to the repository root', () => {
    expect(resolvePackageRootForDir(join('/repo', 'dist', 'dashboard'))).toBe('/repo');
  });

  it('resolves unbundled dist lib paths to the repository root', () => {
    expect(resolvePackageRootForDir(join('/repo', 'dist', 'lib'))).toBe('/repo');
  });
});
