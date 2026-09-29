import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..');

export interface LoadedFixture {
  file: string;
  data: unknown;
}

/**
 * Credential shapes no committed fixture may contain. Fixtures come from real PRs and
 * session transcripts, so every load re-checks them.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/,
  /\bsk-[A-Za-z0-9]{32,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/** Throws naming the label and pattern index — never the matched text. */
export function assertNoSecretPatterns(text: string, label: string): void {
  const index = SECRET_PATTERNS.findIndex((pattern) => pattern.test(text));
  if (index !== -1) {
    throw new Error(`Fixture ${label} contains a credential-shaped string (secret pattern #${index}); scrub it.`);
  }
}

/** UTF-8 read of a repo-relative file (Evalite runs with cwd evals/, so bare relative reads resolve wrongly). */
export function readRepoText(relPath: string): string {
  return readFileSync(path.resolve(repoRoot, relPath), 'utf8');
}

/** Loads every *.json under a repo-relative directory, sorted by file name, after the secret scan. */
export function loadFixtureDir(relDir: string): LoadedFixture[] {
  const dir = path.resolve(repoRoot, relDir);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const file = path.join(relDir, name);
      const raw = readFileSync(path.join(dir, name), 'utf8');
      assertNoSecretPatterns(raw, file);
      return { file, data: JSON.parse(raw) as unknown };
    });
}
