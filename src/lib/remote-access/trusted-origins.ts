/**
 * Trusted origins saved from Settings → Anywhere (PAN-4445 D-3, FR-1, FR-2).
 *
 *   ~/.overdeck/trusted-origins.json  →  { "version": 1, "origins": ["https://desk.tailnet.ts.net"] }
 *
 * `getTrustedOrigins()` (src/dashboard/server/routes/origin-validation.ts)
 * merges these into the dashboard's trusted origins in every launch mode, so
 * an address added from the dashboard works on the next request with no
 * `OVERDECK_TRUSTED_ORIGINS` edit and no restart. This is operator
 * configuration, not derived status. Removing an address means editing the
 * file by hand.
 */
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

import { getOverdeckHome } from '../paths.js';
import { isLoopbackOrigin } from './loopback.js';

const TRUSTED_ORIGINS_FILENAME = 'trusted-origins.json';

interface TrustedOriginsFile {
  version: 1;
  origins: string[];
}

export type AddOriginResult =
  | { ok: true; origin: string; added: boolean }
  | { ok: false; reason: 'invalid' | 'loopback' };

export function trustedOriginsPath(): string {
  return join(getOverdeckHome(), TRUSTED_ORIGINS_FILENAME);
}

/** `scheme://host[:port]` for an http(s) URL; null for anything else. */
export function normalizeTrustedOrigin(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return `${url.protocol}//${url.host}`;
}

function parseOrigins(raw: string): string[] {
  const parsed = JSON.parse(raw) as Partial<TrustedOriginsFile> | null;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.origins) ||
    !parsed.origins.every((origin) => typeof origin === 'string')
  ) {
    throw new Error('expected { "version": 1, "origins": string[] }');
  }
  const origins = new Set<string>();
  for (const origin of parsed.origins) {
    const normalized = normalizeTrustedOrigin(origin);
    if (normalized) origins.add(normalized);
  }
  return Array.from(origins);
}

/**
 * The saved origins, normalized and deduplicated. A missing file is `[]`; an
 * unreadable or invalid one is `[]` plus one warning naming the file.
 *
 * Synchronous on purpose: its one caller is `getTrustedOrigins()`, which is
 * synchronous on the request and WebSocket-upgrade path and reads this only
 * when it fills its cache (PAN-4445 NFR-1, H-5).
 */
export function readSavedTrustedOriginsSync(): string[] {
  const path = trustedOriginsPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    console.warn(`[trusted-origins] ignoring unreadable ${path}: ${(error as Error).message}`);
    return [];
  }
  try {
    return parseOrigins(raw);
  } catch (error) {
    console.warn(`[trusted-origins] ignoring invalid ${path}: ${(error as Error).message}`);
    return [];
  }
}

/** Async read for the write path. An invalid file throws rather than being overwritten. */
async function readSavedOriginsForUpdate(path: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`Cannot read ${path}: ${(error as Error).message}`);
  }
  try {
    return parseOrigins(raw);
  } catch (error) {
    throw new Error(`Cannot update ${path}: ${(error as Error).message}. Fix or delete the file.`);
  }
}

/**
 * Save an origin another device uses to reach this dashboard. Refuses
 * non-http(s) and loopback origins, and reports `added: false` when the origin
 * is already trusted (in `alreadyTrusted` or in the file). The caller must
 * call `invalidateTrustedOriginsCache()` after an add. An invalid file throws
 * instead of being replaced, so a hand edit is never silently lost.
 */
export async function addSavedTrustedOrigin(raw: string, alreadyTrusted: readonly string[]): Promise<AddOriginResult> {
  const origin = normalizeTrustedOrigin(raw);
  if (!origin) return { ok: false, reason: 'invalid' };
  if (isLoopbackOrigin(origin)) return { ok: false, reason: 'loopback' };

  const path = trustedOriginsPath();
  const existing = await readSavedOriginsForUpdate(path);
  if (alreadyTrusted.includes(origin) || existing.includes(origin)) {
    return { ok: true, origin, added: false };
  }

  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const body: TrustedOriginsFile = { version: 1, origins: [...existing, origin] };
  try {
    await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o644 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return { ok: true, origin, added: true };
}
