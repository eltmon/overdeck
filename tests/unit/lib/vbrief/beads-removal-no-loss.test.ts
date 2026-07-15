/**
 * PAN-2648 WI-1 no-loss gate.
 *
 * Baseline/final line-count command for the WI-8 report:
 *   git diff --numstat 53fb832a11..HEAD
 *
 * End-state scans are live after the removal completed in WI-8.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BEADS_REMOVAL_NO_LOSS_MATRIX } from '../overdeck/no-loss-matrix.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const TEXT_EXTENSIONS = new Set(['.js', '.json', '.md', '.mdx', '.mjs', '.ts', '.tsx']);
const SCAN_ROOTS = ['src', 'sync-sources', 'configuration', 'reference'];
const LIVE_DOC_ROOTS = ['docs'];
const EXCLUDED_DOC_PREFIXES = ['docs/history/', 'docs/prds/', 'docs/research/', 'docs/FLYWHEEL-STATE.md'];

interface Finding {
  file: string;
  line: number;
  text: string;
}

function textFiles(path: string): string[] {
  const absolute = join(ROOT, path);
  if (statSync(absolute).isFile()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return textFiles(child);
    return entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name)) ? [join(ROOT, child)] : [];
  });
}

function scan(pattern: RegExp): Finding[] {
  const roots = [...SCAN_ROOTS, ...LIVE_DOC_ROOTS, 'package.json'];
  const files = roots.flatMap(textFiles).filter((file) => {
    const path = relative(ROOT, file);
    return !EXCLUDED_DOC_PREFIXES.some((prefix) => path.startsWith(prefix));
  });

  return files.flatMap((file) =>
    readFileSync(file, 'utf8').split('\n').flatMap((text, index) => {
      pattern.lastIndex = 0;
      return pattern.test(text)
        ? [{ file: relative(ROOT, file), line: index + 1, text: text.trim() }]
        : [];
    }),
  );
}

describe('PAN-2648 Beads-removal no-loss audit', () => {
  it('maps every legacy surface to a concrete retention target or deletion reason', () => {
    expect(BEADS_REMOVAL_NO_LOSS_MATRIX).toHaveLength(28);
    expect(BEADS_REMOVAL_NO_LOSS_MATRIX.every(({ target }) => target.trim().length > 0)).toBe(true);
    expect(new Set(BEADS_REMOVAL_NO_LOSS_MATRIX.map(({ surface }) => surface)).size).toBe(
      BEADS_REMOVAL_NO_LOSS_MATRIX.length,
    );
  });

  it('uses only the two approved dispositions', () => {
    const invalid = BEADS_REMOVAL_NO_LOSS_MATRIX.filter(
      ({ disposition }) => disposition !== 'RETAIN_AS_TASK' && disposition !== 'DELETE',
    );
    expect(invalid).toEqual([]);
  });

  it('has no production Beads imports or process-lock/mutation dependencies', () => {
    expect(scan(/BeadsResolver|runMutationBatch|withBdProcessLock/)).toEqual([]);
  });

  it('has no Beads sync or rollup service dependencies', () => {
    expect(scan(/BeadsRollup|beads-(?:rollup|sync)(?:-service|-singleton)?/i)).toEqual([]);
  });

  it('has no live pan beads or bd ready instructions', () => {
    expect(scan(/\bpan beads\b|\bbd ready\b/)).toEqual([]);
  });

  it('has no code that executes the bd process', () => {
    expect(scan(/(?:execFile|exec|spawn)(?:Sync)?\s*\([^\n]*['"`]bd['"`]/)).toEqual([]);
  });
});
