/**
 * PAN-639 regression tests: beads must be tracked in git.
 *
 * Verifies that .beads/ is not gitignored and that essential beads files exist.
 * This is the core regression guard against a repeat of commit fe2c7803.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const gitignorePath = join(ROOT, '.gitignore');

describe('PAN-639: beads git tracking', () => {
  it('.beads/ must NOT be gitignored', () => {
    const content = readFileSync(gitignorePath, 'utf-8');
    const lines = content.split('\n');

    // Find uncommented lines that would ignore .beads/
    const activeBeadsIgnore = lines.filter(
      (line) => !line.trimStart().startsWith('#') && /^\s*\.beads\/?\s*$/.test(line)
    );

    expect(activeBeadsIgnore).toEqual([]);
  });

  it('.planning/beads/ must NOT be gitignored', () => {
    const content = readFileSync(gitignorePath, 'utf-8');
    const lines = content.split('\n');

    const activePlanningBeadsIgnore = lines.filter(
      (line) => !line.trimStart().startsWith('#') && /^\s*\.planning\/beads\/?\s*$/.test(line)
    );

    expect(activePlanningBeadsIgnore).toEqual([]);
  });

  it('.beads/.gitignore must exist', () => {
    expect(existsSync(join(ROOT, '.beads', '.gitignore'))).toBe(true);
  });

  it('.beads/issues.jsonl must exist', () => {
    expect(existsSync(join(ROOT, '.beads', 'issues.jsonl'))).toBe(true);
  });
});
