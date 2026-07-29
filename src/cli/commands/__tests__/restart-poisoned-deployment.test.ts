/**
 * PAN-3264: `pan restart --dashboard` relaunched a `pan reload` generation whose
 * node_modules had gone dangling underneath the running server, forever. The
 * active-bundle marker only checked that `dist/dashboard/server.js` existed —
 * and it did — so every restart booted a tree that died on
 * ERR_MODULE_NOT_FOUND, and the watchdog looped on it for 14 minutes until a
 * human ran `git checkout` and `bun install` by hand.
 *
 * The recovery these lock: an unbootable active deployment is ignored, so
 * restart falls back to the checkout's own build (the same commit, copied there
 * by activateDashboardDeployment, resolving against complete node_modules).
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveBundledServerPath, resolvePrimaryDashboardIdentity } from '../restart.js';

let tmpRoot: string;
let overdeckHomeBefore: string | undefined;

/** A deployment generation whose server bundle imports `effect`. */
function writeGeneration(name: string, installEffect: boolean): string {
  const deployRoot = join(tmpRoot, 'deployments', 'dashboard', name);
  mkdirSync(join(deployRoot, 'dist', 'dashboard'), { recursive: true });
  writeFileSync(
    join(deployRoot, 'dist', 'dashboard', 'server.js'),
    'import { Effect } from "effect";\nexport { Effect };\n',
  );

  if (installEffect) {
    const packageDir = join(deployRoot, 'node_modules', 'effect');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, 'package.json'), '{"name":"effect","main":"index.js"}\n');
    writeFileSync(join(packageDir, 'index.js'), 'module.exports = {};\n');
  } else {
    // Bun's isolated layout points every top-level entry at node_modules/.bun;
    // deleting that store leaves the symlinks dangling, which is what gutted
    // the live generation.
    mkdirSync(join(deployRoot, 'node_modules'), { recursive: true });
    symlinkSync(
      join(deployRoot, 'node_modules', '.bun', 'effect@4.0.0', 'node_modules', 'effect'),
      join(deployRoot, 'node_modules', 'effect'),
      'dir',
    );
  }

  return deployRoot;
}

function writeActiveMarker(repoRoot: string, deployRoot: string): void {
  writeFileSync(
    join(tmpRoot, 'active-dashboard-bundle.json'),
    `${JSON.stringify({
      repoRoot,
      deployRoot,
      serverPath: join(deployRoot, 'dist', 'dashboard', 'server.js'),
    })}\n`,
  );
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'restart-poisoned-'));
  overdeckHomeBefore = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tmpRoot;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (overdeckHomeBefore === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = overdeckHomeBefore;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('restart against a poisoned deployment (PAN-3264)', () => {
  it('uses the active deployment while it can still boot', () => {
    const deployRoot = writeGeneration('.pan-reload-generation-a', true);
    writeActiveMarker('/repo/root', deployRoot);

    expect(resolveBundledServerPath()).toBe(join(deployRoot, 'dist', 'dashboard', 'server.js'));
    expect(resolvePrimaryDashboardIdentity().repoRoot).toBe('/repo/root');
  });

  it('ignores an active deployment whose externals no longer resolve', () => {
    const deployRoot = writeGeneration('.pan-reload-generation-b', false);
    writeActiveMarker('/repo/root', deployRoot);

    const resolved = resolveBundledServerPath();

    expect(resolved).not.toBe(join(deployRoot, 'dist', 'dashboard', 'server.js'));
    expect(resolved).not.toContain('.pan-reload-generation-b');
    // The identity must fall back with it, or the health check would compare
    // against a repoRoot the surviving server never reports.
    expect(resolvePrimaryDashboardIdentity().repoRoot).not.toBe('/repo/root');
  });

  it('explains the rejection so the loop is diagnosable from the restart output', () => {
    const deployRoot = writeGeneration('.pan-reload-generation-b', false);
    writeActiveMarker('/repo/root', deployRoot);

    resolveBundledServerPath();

    const warning = vi.mocked(console.warn).mock.calls.flat().join(' ');
    expect(warning).toContain('effect');
    expect(warning).toContain('Ignoring the active deployment');
  });
});
