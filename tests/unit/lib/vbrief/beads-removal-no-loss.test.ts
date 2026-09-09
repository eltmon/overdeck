import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BEADS_REMOVAL_NO_LOSS_MATRIX } from '../overdeck/no-loss-matrix.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SCAN_ROOTS = ['src', 'sync-sources', 'configuration', 'reference', 'docs'];
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.md', '.mdx', '.json', '.yaml', '.yml']);

const FORBIDDEN = [
  { name: 'bd process execution', pattern: /(?:exec|spawn|command|binary)[^\n]{0,100}['"`]bd['"`]/i },
  { name: 'BeadsResolver', pattern: /\bBeadsResolver\b/ },
  { name: 'Beads mutation batch', pattern: /\brunMutationBatch\b/ },
  { name: 'Beads process lock', pattern: /\bwithBdProcessLock\b/ },
  { name: 'Beads sync or rollup service', pattern: /\b(?:Beads(?:Sync|Rollup)|beads(?:Sync|Rollup)(?:Service)?)\b/i },
  { name: 'live pan beads instruction', pattern: /\bpan beads(?:\s|`)/i },
];

function walk(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap(entry => walk(join(path, entry)));
}

function findForbiddenBeadsReferences(): string[] {
  const files = SCAN_ROOTS.flatMap(root => walk(join(ROOT, root)))
    .filter(path => TEXT_EXTENSIONS.has(extname(path)));
  files.push(join(ROOT, 'package.json'));

  const violations: string[] = [];
  for (const path of files) {
    const source = readFileSync(path, 'utf8');
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(source)) violations.push(`${relative(ROOT, path)}: ${rule.name}`);
    }
  }
  return violations.sort();
}

describe('PAN-2648 Beads removal no-loss gate', () => {
  it('accounts for every legacy surface with a concrete disposition', () => {
    expect(BEADS_REMOVAL_NO_LOSS_MATRIX).toHaveLength(28);
    expect(BEADS_REMOVAL_NO_LOSS_MATRIX.every(entry =>
      (entry.disposition === 'RETAIN_AS_TASK' || entry.disposition === 'DELETE') &&
      entry.surface.trim().length > 0 &&
      entry.target.trim().length > 0,
    )).toBe(true);
    expect(new Set(BEADS_REMOVAL_NO_LOSS_MATRIX.map(entry => entry.surface)).size).toBe(28);
  });

  // This expected failure locks the pre-removal baseline. Once WI-3 through
  // WI-7 remove the violations, Vitest reports an unexpected pass and forces
  // the implementer to convert this into a normal passing test.
  it.fails('contains no live Beads runtime or operator-instruction dependencies', () => {
    expect(findForbiddenBeadsReferences()).toEqual([]);
  });
});
