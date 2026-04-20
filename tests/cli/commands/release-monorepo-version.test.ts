import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');

function readPkgVersion(path: string): string {
  const pkg = JSON.parse(readFileSync(path, 'utf-8')) as { version: string };
  return pkg.version;
}

describe('release monorepo versioning invariant', () => {
  it('root and apps/desktop package.json versions match', () => {
    const rootVersion = readPkgVersion(join(repoRoot, 'package.json'));
    const desktopVersion = readPkgVersion(join(repoRoot, 'apps', 'desktop', 'package.json'));

    expect(desktopVersion).toBe(rootVersion);
  });
});
