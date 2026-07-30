import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { isDeploymentGenerationRoot, resolveSyncSourcesRoot } from '../paths.js';

const GENERATION = join('/home/u', '.overdeck', 'deployments', 'dashboard', '.pan-reload-generation-b');
const CHECKOUT = '/home/u/Projects/overdeck';

describe('isDeploymentGenerationRoot', () => {
  it('recognizes both pan reload generation roots', () => {
    expect(isDeploymentGenerationRoot(join('/x', '.pan-reload-generation-a'))).toBe(true);
    expect(isDeploymentGenerationRoot(join('/x', '.pan-reload-generation-b'))).toBe(true);
  });

  it('does not treat a checkout or an npm install as a generation', () => {
    expect(isDeploymentGenerationRoot(CHECKOUT)).toBe(false);
    expect(isDeploymentGenerationRoot('/usr/lib/node_modules/@overdeck/core')).toBe(false);
    // In-flight build dirs use a different prefix and are never the CLI's root.
    expect(isDeploymentGenerationRoot(join('/x', '.pan-reload-build-previous'))).toBe(false);
  });
});

describe('resolveSyncSourcesRoot', () => {
  it('uses the package tree for a normal checkout or install', () => {
    const root = resolveSyncSourcesRoot(CHECKOUT, {
      repoRoot: () => CHECKOUT,
      exists: () => true,
    });

    expect(root).toBe(join(CHECKOUT, 'sync-sources'));
  });

  it('prefers the recorded checkout when the CLI runs from a frozen generation', () => {
    // PAN-3327: the generation's sync-sources/ is a snapshot of whatever commit
    // the last `pan reload` built, so syncing from it copies stale hooks over
    // themselves and reports success.
    const root = resolveSyncSourcesRoot(GENERATION, {
      repoRoot: () => CHECKOUT,
      exists: (path) => path === join(CHECKOUT, 'sync-sources'),
    });

    expect(root).toBe(join(CHECKOUT, 'sync-sources'));
  });

  it('falls back to the generation when no checkout is recorded', () => {
    const root = resolveSyncSourcesRoot(GENERATION, {
      repoRoot: () => null,
      exists: () => true,
    });

    expect(root).toBe(join(GENERATION, 'sync-sources'));
  });

  it('falls back to the generation when the recorded checkout has no sync sources', () => {
    const root = resolveSyncSourcesRoot(GENERATION, {
      repoRoot: () => CHECKOUT,
      exists: () => false,
    });

    expect(root).toBe(join(GENERATION, 'sync-sources'));
  });
});
