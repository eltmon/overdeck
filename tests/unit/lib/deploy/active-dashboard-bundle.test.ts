import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  activeDashboardBundleFile,
  readActiveDashboardBundleSync,
  writeActiveDashboardBundle,
} from '../../../../src/lib/deploy/active-dashboard-bundle.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;
const temporaryRoots: string[] = [];

afterEach(async () => {
  if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalOverdeckHome;
  await Promise.all(temporaryRoots.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })));
});

async function createFixture(): Promise<{ home: string; repoRoot: string; deployRoot: string; serverPath: string }> {
  const home = await fs.mkdtemp(join(tmpdir(), 'overdeck-active-bundle-'));
  temporaryRoots.push(home);
  process.env.OVERDECK_HOME = home;
  const repoRoot = join(home, 'repo');
  const deployRoot = join(home, 'deployments', 'dashboard', 'build-1');
  const serverPath = join(deployRoot, 'dist', 'dashboard', 'server.js');
  await fs.mkdir(join(deployRoot, 'dist', 'dashboard'), { recursive: true });
  await fs.writeFile(serverPath, 'export {};');
  return { home, repoRoot, deployRoot, serverPath };
}

describe('active dashboard bundle', () => {
  it('atomically records and resolves a canonical deployment bundle', async () => {
    const { repoRoot, deployRoot, serverPath } = await createFixture();

    await writeActiveDashboardBundle({ repoRoot, deployRoot, serverPath });

    expect(readActiveDashboardBundleSync()).toEqual({ repoRoot, deployRoot, serverPath });
  });

  it('rejects missing bundle files and paths outside the deployment root', async () => {
    const { repoRoot, deployRoot, serverPath } = await createFixture();
    await fs.writeFile(activeDashboardBundleFile(), JSON.stringify({
      repoRoot,
      deployRoot,
      serverPath: join(repoRoot, 'untrusted-server.js'),
    }));
    expect(readActiveDashboardBundleSync()).toBeNull();

    await fs.writeFile(activeDashboardBundleFile(), JSON.stringify({ repoRoot, deployRoot, serverPath }));
    await fs.rm(serverPath);
    expect(readActiveDashboardBundleSync()).toBeNull();
  });

  it('removes the marker when restoring a pre-deployment state', async () => {
    const { repoRoot, deployRoot, serverPath } = await createFixture();
    await writeActiveDashboardBundle({ repoRoot, deployRoot, serverPath });

    await writeActiveDashboardBundle(null);

    expect(readActiveDashboardBundleSync()).toBeNull();
  });
});
