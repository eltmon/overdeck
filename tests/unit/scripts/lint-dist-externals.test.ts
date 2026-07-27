import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * PAN-3209: `npx @overdeck/core` crashed with ERR_MODULE_NOT_FOUND because a
 * dist bundle imported `posthog-node`, which package.json never declared.
 * These tests lock the guard that makes that state a build failure.
 */

const SCRIPT = new URL('../../../scripts/lint-dist-externals.mjs', import.meta.url).pathname;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRoot(pkg: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-dist-externals-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module', ...pkg }));
  return root;
}

function writeDistFile(root: string, relativePath: string, source: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}

function writeAllowlist(root: string, contents: string): void {
  writeFileSync(join(root, 'scripts', 'dist-externals-allowlist.txt'), contents);
}

function run(root: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], { encoding: 'utf-8' });
    return { ok: true, output };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string };
    return { ok: false, output: [error.stdout ?? '', error.stderr ?? ''].join('\n') };
  }
}

describe('lint-dist-externals', () => {
  it('fails when a dist bundle imports a package that package.json never declares', () => {
    const root = makeRoot({ dependencies: { chalk: '^5.0.0' } });
    writeDistFile(root, 'dist/review-status-8rqOvGJV.js', 'import { PostHog } from "posthog-node";\n');

    const { ok, output } = run(root);

    expect(ok).toBe(false);
    expect(output).toContain('posthog-node');
    expect(output).toContain('dist/review-status-8rqOvGJV.js');
    expect(output).toContain('not declared anywhere in package.json');
  });

  it('passes once the package is declared in dependencies', () => {
    const root = makeRoot({ dependencies: { 'posthog-node': '^5.46.0' } });
    writeDistFile(root, 'dist/review-status-8rqOvGJV.js', 'import { PostHog } from "posthog-node";\n');

    const { ok, output } = run(root);

    expect(ok).toBe(true);
    expect(output).toContain('dist externals OK');
  });

  it('rejects a devDependency as satisfying a dist import', () => {
    const root = makeRoot({ devDependencies: { 'posthog-node': '^5.46.0' } });
    writeDistFile(root, 'dist/review-status.js', 'import { PostHog } from "posthog-node";\n');

    const { ok, output } = run(root);

    expect(ok).toBe(false);
    expect(output).toContain('it is a devDependency');
  });

  it('accepts optionalDependencies and peerDependencies', () => {
    const root = makeRoot({
      optionalDependencies: { 'some-optional': '^1.0.0' },
      peerDependencies: { 'some-peer': '^2.0.0' },
    });
    writeDistFile(root, 'dist/index.js', 'import "some-optional";\nimport "some-peer";\n');

    expect(run(root).ok).toBe(true);
  });

  it('resolves scoped and subpath specifiers to their package name', () => {
    const root = makeRoot({ dependencies: { '@effect/platform-node': '^1.0.0', 'drizzle-orm': '^0.44.0' } });
    writeDistFile(
      root,
      'dist/index.js',
      'import { NodeRuntime } from "@effect/platform-node/NodeRuntime";\nimport { sql } from "drizzle-orm/sql";\n',
    );

    expect(run(root).ok).toBe(true);
  });

  it('catches a dynamic import of an undeclared package', () => {
    const root = makeRoot({});
    writeDistFile(root, 'dist/dashboard/server.js', 'const { chromium } = await import("playwright");\n');

    const { ok, output } = run(root);

    expect(ok).toBe(false);
    expect(output).toContain('playwright');
  });

  it('ignores relative paths, node: builtins, bare builtins and bun: modules', () => {
    const root = makeRoot({});
    writeDistFile(
      root,
      'dist/index.js',
      [
        'import { readFileSync } from "node:fs";',
        'import { join } from "path";',
        'import helper from "./helper-Ab12cd.js";',
        'const { Database } = await import("bun:sqlite");',
      ].join('\n'),
    );

    expect(run(root).ok).toBe(true);
  });

  it('ignores the browser bundle under dist/dashboard/public', () => {
    const root = makeRoot({});
    writeDistFile(root, 'dist/dashboard/public/assets/index-Xy12.js', 'import React from "react";\n');

    expect(run(root).ok).toBe(true);
  });

  it('ignores AMD/UMD define arrays and bundler require shims in inlined third-party code', () => {
    const root = makeRoot({});
    writeDistFile(
      root,
      'dist/dashboard/src-rac0Mepv.js',
      [
        'typeof define === "function" && define.amd ? define(["protobufjs/minimal"], factory) : null;',
        'typeof define === "function" && define.amd ? define(["exports"], factory) : null;',
        'typeof __require === "function" ? require("chromium-bidi/lib/cjs/bidiMapper") : null;',
      ].join('\n'),
    );

    expect(run(root).ok).toBe(true);
  });

  it('suppresses an import via an allowlist entry that names an issue', () => {
    const root = makeRoot({});
    writeDistFile(root, 'dist/dashboard/server.js', 'const { chromium } = await import("playwright");\n');
    writeAllowlist(root, 'playwright  # PAN-1645 optional, guarded call site\n');

    const { ok, output } = run(root);

    expect(ok).toBe(true);
    expect(output).toContain('1 allowlisted');
  });

  it('rejects an allowlist entry with no issue reference', () => {
    const root = makeRoot({});
    writeDistFile(root, 'dist/dashboard/server.js', 'const { chromium } = await import("playwright");\n');
    writeAllowlist(root, 'playwright  # it is fine, trust me\n');

    const { ok, output } = run(root);

    expect(ok).toBe(false);
    expect(output).toContain('expected "<package>  # <ISSUE-REF> <reason>"');
  });

  it('rejects an allowlist entry that no dist bundle imports', () => {
    const root = makeRoot({});
    writeDistFile(root, 'dist/index.js', 'export const noop = () => {};\n');
    writeAllowlist(root, 'playwright  # PAN-1645 optional, guarded call site\n');

    const { ok, output } = run(root);

    expect(ok).toBe(false);
    expect(output).toContain('delete the stale entry');
  });

  it('fails with a build hint when dist does not exist', () => {
    const root = makeRoot({});
    rmSync(join(root, 'dist'), { recursive: true, force: true });

    const { ok, output } = run(root);

    expect(ok).toBe(false);
    expect(output).toContain('npm run build');
  });

  it('stays wired into npm run build', () => {
    // The guard only protects a publish/link if it actually runs during the
    // build. build-post-cli.mjs is the final step of `npm run build`, invoked
    // after every bundle is emitted.
    const repoRoot = new URL('../../../', import.meta.url).pathname;
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>;
    };
    const buildPostCli = readFileSync(join(repoRoot, 'scripts', 'build-post-cli.mjs'), 'utf-8');

    expect(pkg.scripts['lint:dist-externals']).toBe('node scripts/lint-dist-externals.mjs');
    expect(pkg.scripts.build).toContain('scripts/build-post-cli.mjs');
    expect(buildPostCli).toContain("runTask('lint:dist-externals')");
  });
});
