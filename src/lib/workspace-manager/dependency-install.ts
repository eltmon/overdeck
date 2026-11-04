import { existsSync } from 'fs';
import { join } from 'path';

export type WorkspacePackageManager = 'bun' | 'npm' | 'pnpm';

/** True when `dir` holds a package.json. A package manager must never run without one:
 * npm walks up to the nearest ancestor with node_modules and writes a lockfile there (PAN-4929). */
export function hasPackageJson(dir: string): boolean {
  return existsSync(join(dir, 'package.json'));
}

export function installCommandFor(pkgManager: WorkspacePackageManager): string {
  return pkgManager === 'bun' ? 'bun install' : `${pkgManager} install`;
}
