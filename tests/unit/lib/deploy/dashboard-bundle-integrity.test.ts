/**
 * PAN-3264: a live `pan reload` generation was gutted underneath the running
 * dashboard — its Bun store went away and every top-level node_modules entry
 * became a dangling symlink — while `dist/dashboard/server.js` stayed on disk.
 * Existence-based checks all passed, so restart relaunched the poisoned tree
 * indefinitely. These lock the behaviour that existence is not bootability.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dashboardServerBootFailure } from '../../../../src/lib/deploy/dashboard-bundle-integrity.js';

let tmpRoot: string;

/** A deployment whose server bundle imports `effect`, installed or not. */
function makeDeployment(name: string, install: 'real' | 'dangling' | 'absent'): string {
  const deployRoot = join(tmpRoot, name);
  mkdirSync(join(deployRoot, 'dist', 'dashboard'), { recursive: true });
  writeFileSync(
    join(deployRoot, 'dist', 'dashboard', 'server.js'),
    'import { Effect } from "effect";\nexport { Effect };\n',
  );

  if (install === 'real') {
    const packageDir = join(deployRoot, 'node_modules', 'effect');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, 'package.json'), '{"name":"effect","main":"index.js"}\n');
    writeFileSync(join(packageDir, 'index.js'), 'module.exports = {};\n');
  } else if (install === 'dangling') {
    // Bun's isolated layout: every top-level entry is a symlink into
    // node_modules/.bun. Deleting that store leaves the symlink pointing at
    // nothing, which is exactly the state the outage left behind.
    mkdirSync(join(deployRoot, 'node_modules'), { recursive: true });
    symlinkSync(
      join(deployRoot, 'node_modules', '.bun', 'effect@4.0.0', 'node_modules', 'effect'),
      join(deployRoot, 'node_modules', 'effect'),
      'dir',
    );
  }

  return join(deployRoot, 'dist', 'dashboard', 'server.js');
}

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'dashboard-bundle-integrity-'));
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('dashboardServerBootFailure', () => {
  it('passes a deployment whose server bundle resolves its externals', () => {
    expect(dashboardServerBootFailure(makeDeployment('healthy', 'real'))).toBeNull();
  });

  it('names the package a gutted Bun store left as a dangling symlink', () => {
    const failure = dashboardServerBootFailure(makeDeployment('gutted', 'dangling'));

    expect(failure).toContain('effect');
    expect(failure).toContain('ERR_MODULE_NOT_FOUND');
    expect(failure).toContain('bun install');
  });

  it('rejects a deployment whose externals were never installed', () => {
    expect(dashboardServerBootFailure(makeDeployment('uninstalled', 'absent'))).toContain('effect');
  });

  it('reports a deployment that never built the server bundle at all', () => {
    const serverPath = join(tmpRoot, 'unbuilt', 'dist', 'dashboard', 'server.js');

    expect(dashboardServerBootFailure(serverPath)).toContain('Dashboard bundle missing');
  });
});
