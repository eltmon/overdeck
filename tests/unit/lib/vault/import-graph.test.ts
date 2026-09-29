/**
 * PAN-2609 P-14 / NFR-7: `pan vault` must stay standalone. This walks every
 * static `import … from` and dynamic `import()` specifier reachable from the
 * vault CLI verbs and library, following relative imports recursively, and
 * fails when any module resolves into the dashboard, the terminal backends,
 * the Overdeck orchestration layer, Effect, or a node-pty package.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ENTRY_DIRS = ['src/cli/commands/vault', 'src/lib/vault'];
const BANNED_PATH_PREFIXES = ['src/dashboard/', 'src/lib/terminal-backends/', 'src/lib/overdeck/'];
const BANNED_PACKAGES = [/^effect(\/|$)/, /^@effect\//, /node-pty/];

const SPECIFIER_PATTERN = /(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const TYPE_ONLY_IMPORT = /^\s*(?:import|export)\s+type\s/;

/** Drop block and line comments so a JSDoc example never counts as an import. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    base,
    `${base}.ts`,
    join(base, 'index.ts'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export interface ImportViolation {
  chain: string[];
  specifier: string;
}

export interface WalkResult {
  modules: number;
  violations: ImportViolation[];
}

/** Walk the import graph from `entries`; returns module count and every banned edge with its chain. */
export function walkImportGraph(entries: readonly string[], repoRoot = REPO_ROOT): WalkResult {
  const seen = new Set<string>();
  const violations: ImportViolation[] = [];
  const queue: Array<{ file: string; chain: string[] }> = entries.map((file) => ({ file, chain: [relative(repoRoot, file)] }));
  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(SPECIFIER_PATTERN)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) continue;
      // Type-only imports are erased at compile time and load nothing.
      if (TYPE_ONLY_IMPORT.test(match[0].replace(/^\n/, ''))) continue;
      if (specifier.startsWith('node:')) continue;
      if (specifier.startsWith('.')) {
        const target = resolveRelative(file, specifier);
        if (!target) continue;
        const rel = relative(repoRoot, target).split('\\').join('/');
        if (BANNED_PATH_PREFIXES.some((prefix) => rel.startsWith(prefix))) {
          violations.push({ chain: [...chain, rel], specifier });
          continue;
        }
        queue.push({ file: target, chain: [...chain, rel] });
        continue;
      }
      if (BANNED_PACKAGES.some((pattern) => pattern.test(specifier))) {
        violations.push({ chain: [...chain, specifier], specifier });
      }
    }
  }
  return { modules: seen.size, violations };
}

function formatViolations(violations: ImportViolation[]): string {
  return violations.map((violation) => violation.chain.join(' -> ')).join('\n');
}

describe('pan vault import graph (P-14)', () => {
  it('ac1: nothing reachable from the vault modules imports a banned layer', () => {
    const entries = ENTRY_DIRS.flatMap((dir) => listTsFiles(join(REPO_ROOT, dir)));
    expect(entries.length).toBeGreaterThan(0);
    const result = walkImportGraph(entries);
    console.log(`[import-graph] walked ${result.modules} modules from ${entries.length} vault entry files`);
    expect(result.modules).toBeGreaterThanOrEqual(entries.length);
    expect(result.violations, formatViolations(result.violations)).toEqual([]);
  });

  it('ac2: a fixture that reaches src/lib/overdeck fails naming the chain', () => {
    const fixtureDir = join(REPO_ROOT, '.tmp', 'import-graph-fixture');
    const fixture = join(fixtureDir, 'bad-entry.ts');
    const { mkdirSync, writeFileSync, rmSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(fixtureDir, { recursive: true });
    const target = relative(fixtureDir, join(REPO_ROOT, 'src', 'lib', 'overdeck', 'conversations.ts')).replace(/\.ts$/, '.js');
    writeFileSync(fixture, `import { listConversations } from '${target}';\nexport const x = listConversations;\n`);
    try {
      const result = walkImportGraph([fixture]);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.chain).toEqual(['.tmp/import-graph-fixture/bad-entry.ts', 'src/lib/overdeck/conversations.ts']);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('flags banned packages reached through a dynamic import', () => {
    const fixtureDir = join(REPO_ROOT, '.tmp', 'import-graph-fixture-pkg');
    const fixture = join(fixtureDir, 'entry.ts');
    const { mkdirSync, writeFileSync, rmSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(fixture, `export async function load() { return (await import('effect')).Effect; }\nexport const pty = () => import('@lydell/node-pty');\n`);
    try {
      const result = walkImportGraph([fixture]);
      expect(result.violations.map((violation) => violation.specifier).sort()).toEqual(['@lydell/node-pty', 'effect']);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
