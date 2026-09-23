import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The desktop release vendors dist/pty-supervisor.js with @lydell/node-pty as
// its only package (apps/desktop/scripts/prepare-server-resources.mjs,
// SUPERVISOR_ALLOWED_EXTERNALS). That check only runs at release time, so a
// supervisor import of config.js (effect, @iarna/toml, yaml) broke the v0.51.0
// and v0.60.0 desktop publishes unnoticed. This walks the same closure over the
// TypeScript source on every PR.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const entry = join(repoRoot, 'src/lib/channels/pty-supervisor.ts');
const ALLOWED_PACKAGES = new Set(['@lydell/node-pty']);
const BUILTINS = new Set(builtinModules);

function runtimeSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  // Static imports/re-exports that survive compilation (not `import type`).
  const staticRe = /^\s*(import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(staticRe)) specifiers.push(match[2]!);
  for (const match of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(match[1]!);
  return specifiers;
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts'), base]) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
  }
  return null;
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

describe('pty-supervisor import closure', () => {
  it('depends on no package except @lydell/node-pty', () => {
    const seen = new Set<string>([entry]);
    const queue = [entry];
    const offenders: string[] = [];
    while (queue.length > 0) {
      const file = queue.shift()!;
      for (const specifier of runtimeSpecifiers(readFileSync(file, 'utf8'))) {
        if (specifier.startsWith('.')) {
          const next = resolveRelative(file, specifier);
          if (next && !seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
          continue;
        }
        const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
        if (BUILTINS.has(bare) || BUILTINS.has(bare.split('/')[0]!)) continue;
        const pkg = packageName(specifier);
        if (!ALLOWED_PACKAGES.has(pkg)) offenders.push(`${pkg} (imported by ${relative(repoRoot, file)})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
