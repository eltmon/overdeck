import { existsSync, promises as fs, readFileSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';

import { getOverdeckHome } from '../paths.js';

export interface ActiveDashboardBundle {
  readonly repoRoot: string;
  readonly deployRoot: string;
  readonly serverPath: string;
}

export function activeDashboardBundleFile(): string {
  return join(getOverdeckHome(), 'active-dashboard-bundle.json');
}

function isInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(resolve(parent), resolve(candidate));
  return pathFromParent === '' || (
    pathFromParent !== '..'
    && !pathFromParent.startsWith(`..${sep}`)
  );
}

export function readActiveDashboardBundleSync(): ActiveDashboardBundle | null {
  try {
    const parsed = JSON.parse(readFileSync(activeDashboardBundleFile(), 'utf8')) as Partial<ActiveDashboardBundle>;
    if (
      typeof parsed.repoRoot !== 'string'
      || typeof parsed.deployRoot !== 'string'
      || typeof parsed.serverPath !== 'string'
      || !isInside(parsed.deployRoot, parsed.serverPath)
      || !existsSync(parsed.serverPath)
    ) {
      return null;
    }
    return {
      repoRoot: resolve(parsed.repoRoot),
      deployRoot: resolve(parsed.deployRoot),
      serverPath: resolve(parsed.serverPath),
    };
  } catch {
    return null;
  }
}

export async function writeActiveDashboardBundle(bundle: ActiveDashboardBundle | null): Promise<void> {
  const markerPath = activeDashboardBundleFile();
  if (!bundle) {
    await fs.rm(markerPath, { force: true });
    return;
  }

  await fs.mkdir(dirname(markerPath), { recursive: true });
  const temporaryPath = `${markerPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, markerPath);
}
