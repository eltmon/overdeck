/**
 * PAN-4264: the opt-in pseudonymous `operatorHash`.
 *
 * When `telemetry.operator_grouping` is on, every Node and browser event
 * carries `operatorHash` = HMAC-SHA256(GitHub numeric user id,
 * OPERATOR_HASH_SALT), truncated to 16 hex characters, so the installs one
 * operator runs (a Linux box and a Mac, say) can be grouped. The salt is a
 * pepper in the source, not a secret: pseudonymity holds only against
 * parties without the Overdeck source.
 *
 * The id comes from `gh api user --jq .id`, once, with a direct async
 * `execFile` — not `runGh`, so telemetry never depends on the quota meter
 * (NFR-8). Only the hash is cached, at `~/.overdeck/telemetry-operator-hash`
 * (mode 0600); the raw id is never written or sent. Without gh (or when it is
 * unauthenticated) no hash exists and the property is omitted.
 */
import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { loadConfigSync } from '../config-yaml.js';
import { getOverdeckHome } from '../paths.js';

const execFileAsync = promisify(execFile);

export const OPERATOR_HASH_SALT = 'overdeck-operator-grouping-v1';
const HASH_PATTERN = /^[0-9a-f]{16}$/;

export function computeOperatorHash(userId: number | string): string {
  return createHmac('sha256', OPERATOR_HASH_SALT).update(String(userId)).digest('hex').slice(0, 16);
}

function operatorHashFile(): string {
  return join(getOverdeckHome(), 'telemetry-operator-hash');
}

let cached: { key: string; hash: string | undefined } | null = null;

/** The cached hash, read with a bounded sync read and memoized on path + mtime. */
function readOperatorHash(): string | undefined {
  const file = operatorHashFile();
  try {
    const key = `${file}:${statSync(file).mtimeMs}`;
    if (cached?.key === key) return cached.hash;
    const value = readFileSync(file, 'utf8').trim();
    const hash = HASH_PATTERN.test(value) ? value : undefined;
    cached = { key, hash };
    return hash;
  } catch {
    return undefined;
  }
}

function operatorGroupingEnabled(): boolean {
  try {
    return loadConfigSync().config.telemetry?.operator_grouping === true;
  } catch {
    return false;
  }
}

/** The hash to attach to events, or undefined unless grouping is on and a hash exists. Sync. */
export function getOperatorHashIfEnabled(): string | undefined {
  if (!operatorGroupingEnabled()) return undefined;
  return readOperatorHash();
}

/**
 * When grouping is on and no hash is cached yet, derive it from
 * `gh api user --jq .id` and write only the hash (mode 0600). Never throws.
 * Runs at dashboard boot and after a settings save that turns grouping on.
 */
export async function ensureOperatorHash(
  readUserId: () => Promise<string> = async () =>
    (await execFileAsync('gh', ['api', 'user', '--jq', '.id'], { encoding: 'utf-8', timeout: 15_000 })).stdout,
): Promise<void> {
  try {
    if (!operatorGroupingEnabled() || readOperatorHash()) return;
    const userId = (await readUserId()).trim();
    if (!/^\d+$/.test(userId)) return;
    const file = operatorHashFile();
    await mkdir(getOverdeckHome(), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${computeOperatorHash(userId)}\n`, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, file);
  } catch {
    // gh missing, unauthenticated or offline: no hash, the property is omitted.
  }
}
