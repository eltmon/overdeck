/**
 * Session Vault pre-settlement secret scan (PAN-2609, FR-13, P-8).
 *
 * Every new transcript line is scanned with the blocking patterns from
 * `src/lib/secret-redaction.ts`. A hit blocks the record's settlement and is
 * reported as line number + pattern name only; the matched value never leaves
 * this module. Encryption does not replace the scan: a leaked vault key would
 * expose every saved secret.
 *
 * The operator can allow a specific line for a specific record with
 * `pan vault allow-secret`, which stores the line's hash per vaultId in
 * `${OVERDECK_HOME}/vault/allowed-secrets.json` (machine-local, mode 0600).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findSecretMatches, type SecretPatternName } from '../secret-redaction.js';
import { vaultDir } from './config.js';
import { lineHash } from './continuity.js';
import { withFileLock } from './file-lock.js';

export const ALLOWED_SECRETS_FILENAME = 'allowed-secrets.json';

export interface SecretHit {
  /** 1-based line number in the native transcript. */
  line: number;
  pattern: SecretPatternName;
}

/** `{ [vaultId]: lineHash[] }` */
type AllowedSecrets = Record<string, string[]>;

export function allowedSecretsPath(): string {
  return join(vaultDir(), ALLOWED_SECRETS_FILENAME);
}

async function readAllowed(): Promise<AllowedSecrets> {
  const path = allowedSecretsPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Cannot read ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const allowed: AllowedSecrets = {};
  for (const [vaultId, hashes] of Object.entries(parsed as Record<string, unknown>)) {
    if (Array.isArray(hashes)) allowed[vaultId] = hashes.filter((hash): hash is string => typeof hash === 'string');
  }
  return allowed;
}

async function writeAllowed(allowed: AllowedSecrets): Promise<void> {
  const dir = vaultDir();
  const target = allowedSecretsPath();
  const temp = join(dir, `${ALLOWED_SECRETS_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(temp, `${JSON.stringify(allowed, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** Persist an allow entry for one line hash of one record. Idempotent. */
export async function allowSecret(vaultId: string, hash: string): Promise<void> {
  await mkdir(vaultDir(), { recursive: true });
  await withFileLock(`${allowedSecretsPath()}.lock`, async () => {
    const allowed = await readAllowed();
    const hashes = allowed[vaultId] ?? [];
    if (!hashes.includes(hash)) hashes.push(hash);
    allowed[vaultId] = hashes;
    await writeAllowed(allowed);
  });
}

/** Line hashes the operator has allowed for `vaultId`. */
export async function allowedSecretHashes(vaultId: string): Promise<ReadonlySet<string>> {
  const allowed = await readAllowed();
  return new Set(allowed[vaultId] ?? []);
}

/**
 * Scan `lines` (the new lines of one settlement; `firstLineNumber` is the
 * 1-based transcript line number of `lines[0]`). Lines whose hash is allowed
 * for this record are skipped. One hit per (line, pattern), sorted by line.
 */
export async function scanNewLines(
  vaultId: string | readonly string[],
  lines: readonly string[],
  firstLineNumber: number,
): Promise<SecretHit[]> {
  // A transcript that has never settled has no durable vaultId yet, so the
  // caller may also pass its native path as an allow-list key.
  const keys = typeof vaultId === 'string' ? [vaultId] : vaultId;
  const allowed = new Set<string>();
  for (const key of keys) for (const hash of await allowedSecretHashes(key)) allowed.add(hash);
  const hits: SecretHit[] = [];
  lines.forEach((line, index) => {
    const matches = findSecretMatches(line);
    if (matches.length === 0) return;
    if (allowed.has(lineHash(line))) return;
    const seen = new Set<SecretPatternName>();
    for (const match of matches) {
      if (seen.has(match.pattern)) continue;
      seen.add(match.pattern);
      hits.push({ line: firstLineNumber + index, pattern: match.pattern });
    }
  });
  return hits;
}

export interface WipSecretHit {
  /** Path of the file the added line belongs to, as the patch names it. */
  file: string;
  pattern: SecretPatternName;
  /** lineHash of the added line (without its leading '+'); for `allow-secret --file`, never printed. */
  hash: string;
}

/** `b/src/a.ts` or `"b/sp ace.ts"` → `src/a.ts` / `sp ace.ts`; `/dev/null` → null. */
function patchPath(raw: string, prefix: 'a/' | 'b/'): string | null {
  let path = raw.replace(/\t.*$/, '');
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
  if (path === '/dev/null') return null;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Scan the added lines of a unified patch (`git log -p` / `git diff` output)
 * for WIP capture (PAN-4329 D-4). The current file comes from the `+++ b/<path>`
 * header, or `--- a/<path>` when the new side is `/dev/null`. Only lines added
 * inside a hunk are scanned, so a removed or context line never blocks. One hit
 * per (file, line, pattern); hashes allowed for `vaultId` are skipped. The
 * matched text never appears in the result.
 */
export async function scanWipPatch(vaultId: string, patch: string): Promise<WipSecretHit[]> {
  const allowed = await allowedSecretHashes(vaultId);
  const hits: WipSecretHit[] = [];
  let file = '';
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff ')) {
      file = '';
      inHunk = false;
      continue;
    }
    if (!inHunk) {
      if (line.startsWith('--- ')) file = patchPath(line.slice(4), 'a/') ?? file;
      else if (line.startsWith('+++ ')) file = patchPath(line.slice(4), 'b/') ?? file;
      else if (line.startsWith('@@')) inHunk = true;
      continue;
    }
    if (line.startsWith('@@')) continue;
    if (!line.startsWith('+')) continue;
    const added = line.slice(1);
    const matches = findSecretMatches(added);
    if (matches.length === 0) continue;
    const hash = lineHash(added);
    if (allowed.has(hash)) continue;
    const seen = new Set<SecretPatternName>();
    for (const match of matches) {
      if (seen.has(match.pattern)) continue;
      seen.add(match.pattern);
      hits.push({ file, pattern: match.pattern, hash });
    }
  }
  return hits;
}
