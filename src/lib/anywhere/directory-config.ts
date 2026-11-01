/**
 * The overdeck.ai directory URL (PRD PAN-2356 FR-2356-1, D-2356-19), read from
 * `${OVERDECK_HOME}/config.yaml`:
 *
 *   anywhere:
 *     directory_url: https://connect.overdeck.ai   # the default
 *
 * Self-hosters point it at their own `services/connect`. The URL must be `https:`, or `http:` to a
 * loopback host for local development. It is read at every directory (re)connect, so an edit takes
 * effect on the next connect. There is no Settings field; a Settings save keeps the block.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { getOverdeckHome } from '../paths.js';
import { isLoopbackOrigin } from '../remote-access/loopback.js';

export const DEFAULT_DIRECTORY_URL = 'https://connect.overdeck.ai';

export type DirectoryUrlResult = { url: string } | { error: string };

/** Validates one configured value; the answer never ends in a slash. */
export function parseDirectoryUrl(raw: unknown): DirectoryUrlResult {
  if (raw === undefined || raw === null || raw === '') return { url: DEFAULT_DIRECTORY_URL };
  if (typeof raw !== 'string') return { error: 'anywhere.directory_url must be a URL string' };
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { error: `anywhere.directory_url is not a valid URL: ${raw}` };
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    return { error: 'anywhere.directory_url must not carry a query, fragment or credentials' };
  }
  const insecureLoopback = parsed.protocol === 'http:' && isLoopbackOrigin(parsed.href);
  if (parsed.protocol !== 'https:' && !insecureLoopback) {
    return { error: 'anywhere.directory_url must use https:, or http: to a loopback host' };
  }
  return { url: parsed.href.replace(/\/+$/, '') };
}

export async function readDirectoryUrl(): Promise<DirectoryUrlResult> {
  let text: string;
  try {
    text = await readFile(join(getOverdeckHome(), 'config.yaml'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { url: DEFAULT_DIRECTORY_URL };
    return { error: `Cannot read config.yaml: ${(error as Error).message}` };
  }
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch (error) {
    return { error: `Cannot parse config.yaml: ${(error as Error).message}` };
  }
  const anywhere = typeof doc === 'object' && doc !== null ? (doc as { anywhere?: unknown }).anywhere : undefined;
  const raw = typeof anywhere === 'object' && anywhere !== null ? (anywhere as { directory_url?: unknown }).directory_url : undefined;
  return parseDirectoryUrl(raw);
}

/** `https://host` → `wss://host/v1/directory`; loopback `http:` → `ws:`. */
export function directorySocketUrl(base: string): string {
  return base.replace(/^http/, 'ws') + '/v1/directory';
}
