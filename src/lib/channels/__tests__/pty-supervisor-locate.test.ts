import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  materializePtySupervisorRuntime,
  resolvePtySupervisorScriptPath,
  supervisorDeploymentFailure,
  unresolvedSupervisorImports,
} from '../pty-supervisor-locate.js';

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

// PAN-3172: a `pan reload` deployment generation whose node_modules could not
// resolve @lydell/node-pty produced a supervisor that died on
// ERR_MODULE_NOT_FOUND before binding its socket, so every conversation created
// afterwards timed out. Existence of the artifact is not evidence it can run.
describe('unresolvedSupervisorImports', () => {
  function writeScript(dir: string, body: string): string {
    mkdirSync(dir, { recursive: true });
    const scriptPath = join(dir, 'pty-supervisor.js');
    writeFileSync(scriptPath, body);
    return scriptPath;
  }

  it('reports a bare import that does not resolve from the script location', () => {
    const scriptPath = writeScript(
      join(tmpRoot, 'generation-b', 'dist'),
      'import * as pty from "@lydell/node-pty";\nimport { join } from "node:path";\n',
    );

    expect(unresolvedSupervisorImports(scriptPath)).toEqual(['@lydell/node-pty']);
  });

  it('ignores relative chunks and node: builtins', () => {
    const scriptPath = writeScript(
      join(tmpRoot, 'builtins-only', 'dist'),
      'import { x } from "./paths-K3noE4N_.js";\nimport { createServer } from "node:http";\nexport { y } from "../chunk.js";\n',
    );

    expect(unresolvedSupervisorImports(scriptPath)).toEqual([]);
  });

  it('accepts a bare import whose package is installed beside the script', () => {
    const generationRoot = join(tmpRoot, 'generation-a');
    const packageDir = join(generationRoot, 'node_modules', '@lydell', 'node-pty');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, 'package.json'), '{"name":"@lydell/node-pty","main":"index.js"}\n');
    writeFileSync(join(packageDir, 'index.js'), 'module.exports = {};\n');
    const scriptPath = writeScript(join(generationRoot, 'dist'), 'import * as pty from "@lydell/node-pty";\n');

    expect(unresolvedSupervisorImports(scriptPath)).toEqual([]);
  });

  it('finds every import of the real built supervisor unresolvable from a bare deployment tree', () => {
    // The regression itself: take the artifact this repo actually ships and
    // drop it into a generation whose node_modules is missing.
    const built = resolvePtySupervisorScriptPath();
    const bareDist = join(tmpRoot, 'bare-generation', 'dist');
    mkdirSync(bareDist, { recursive: true });
    const copied = join(bareDist, 'pty-supervisor.js');
    writeFileSync(copied, readFileSync(built, 'utf-8'));

    expect(unresolvedSupervisorImports(built)).toEqual([]);
    expect(unresolvedSupervisorImports(copied)).toContain('@lydell/node-pty');
  });
});

describe('supervisorDeploymentFailure', () => {
  it('passes a deployment whose supervisor resolves its imports', () => {
    const deployRoot = join(tmpRoot, 'good-deploy');
    const packageDir = join(deployRoot, 'node_modules', '@lydell', 'node-pty');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, 'package.json'), '{"name":"@lydell/node-pty","main":"index.js"}\n');
    writeFileSync(join(packageDir, 'index.js'), 'module.exports = {};\n');
    mkdirSync(join(deployRoot, 'dist'), { recursive: true });
    writeFileSync(join(deployRoot, 'dist', 'pty-supervisor.js'), 'import * as pty from "@lydell/node-pty";\n');

    expect(supervisorDeploymentFailure(deployRoot)).toBeNull();
  });

  it('names the missing package when the deployment cannot resolve it', () => {
    const deployRoot = join(tmpRoot, 'bad-deploy');
    mkdirSync(join(deployRoot, 'dist'), { recursive: true });
    writeFileSync(join(deployRoot, 'dist', 'pty-supervisor.js'), 'import * as pty from "@lydell/node-pty";\n');

    expect(supervisorDeploymentFailure(deployRoot)).toContain('@lydell/node-pty');
  });

  it('reports a deployment that never built the supervisor at all', () => {
    const deployRoot = join(tmpRoot, 'unbuilt-deploy');
    mkdirSync(deployRoot, { recursive: true });

    expect(supervisorDeploymentFailure(deployRoot)).toContain('Build did not create');
  });
});
