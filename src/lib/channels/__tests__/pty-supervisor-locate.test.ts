import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { materializePtySupervisorRuntime, resolvePtySupervisorScriptPath } from '../pty-supervisor-locate.js';

// PAN-2592: desktop packaging stages the supervisor chunk closure plus a
// vendored node-pty next to the server bundle; the runtime copies it onto
// durable disk under ${OVERDECK_HOME}/runtime before first use.

let tmpRoot: string;
let stagedDir: string;
let home: string;

beforeEach(() => {
  tmpRoot = join(tmpdir(), `pty-locate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  stagedDir = join(tmpRoot, 'staged', 'supervisor');
  home = join(tmpRoot, 'overdeck-home');
  mkdirSync(join(stagedDir, 'vendor', '@lydell', 'node-pty'), { recursive: true });
  writeFileSync(join(stagedDir, 'pty-supervisor.js'), '#!/usr/bin/env node\nconsole.log("supervisor");\n');
  writeFileSync(join(stagedDir, 'paths-abc123.js'), 'export const x = 1;\n');
  writeFileSync(
    join(stagedDir, 'vendor', '@lydell', 'node-pty', 'package.json'),
    '{"name":"@lydell/node-pty"}\n',
  );
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('materializePtySupervisorRuntime', () => {
  it('copies chunks and remaps vendor/ to node_modules/ on durable disk', () => {
    const entry = materializePtySupervisorRuntime(stagedDir, home);

    expect(existsSync(entry)).toBe(true);
    expect(entry.startsWith(join(home, 'runtime', 'pty-supervisor'))).toBe(true);
    const runtimeDir = join(entry, '..');
    expect(existsSync(join(runtimeDir, 'paths-abc123.js'))).toBe(true);
    expect(existsSync(join(runtimeDir, 'node_modules', '@lydell', 'node-pty', 'package.json'))).toBe(true);
    // The staging-only vendor/ name must not leak into the runtime tree.
    expect(existsSync(join(runtimeDir, 'vendor'))).toBe(false);
  });

  it('is idempotent for identical staged content', () => {
    const first = materializePtySupervisorRuntime(stagedDir, home);
    // Poke the materialized copy so a re-copy would be detectable.
    writeFileSync(join(first, '..', 'marker.txt'), 'kept');
    const second = materializePtySupervisorRuntime(stagedDir, home);

    expect(second).toBe(first);
    expect(readFileSync(join(second, '..', 'marker.txt'), 'utf-8')).toBe('kept');
  });

  it('materializes to a fresh directory when a non-entry staged file changes (app upgrade)', () => {
    const first = materializePtySupervisorRuntime(stagedDir, home);
    writeFileSync(join(stagedDir, 'paths-abc123.js'), 'export const x = 2;\n');
    const second = materializePtySupervisorRuntime(stagedDir, home);

    expect(second).not.toBe(first);
    expect(existsSync(first)).toBe(true);
    expect(existsSync(second)).toBe(true);
  });
});

describe('resolvePtySupervisorScriptPath', () => {
  it('returns the repo-root build artifact in a dev checkout', () => {
    // In this repo the root build output exists, so resolution takes path 1.
    const resolved = resolvePtySupervisorScriptPath();
    expect(resolved.endsWith(join('dist', 'pty-supervisor.js'))).toBe(true);
    expect(existsSync(resolved)).toBe(true);
  });
});
