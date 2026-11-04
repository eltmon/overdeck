/**
 * `remote.enabled` lives only in config.toml `[remote]` (PAN-4905). config.yaml's
 * `remote:` section holds resiliency_tier and max_concurrent_agents only.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { parse } from 'yaml';
import { parse as parseToml } from '@iarna/toml';
import { CONFIG_FILE } from './paths.js';
import { getGlobalConfigPath } from './config-yaml/load.js';
import { writeFileAtomic } from './model-presets/state.js';

export function displayPath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** "add `enabled = true` under `[remote]` in ~/.overdeck/config.toml" */
export function remoteEnabledHint(path: string = CONFIG_FILE): string {
  return `add \`enabled = true\` under \`[remote]\` in ${displayPath(path)}`;
}

/** True when the global config.yaml has a `remote.enabled` key (which nothing reads). */
export async function configYamlSetsRemoteEnabled(path: string = getGlobalConfigPath()): Promise<boolean> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch { return false; }
  try {
    const doc = parse(text) as { remote?: unknown } | null;
    return typeof doc?.remote === 'object' && doc.remote !== null && Object.hasOwn(doc.remote, 'enabled');
  } catch { return false; }
}

export class RemoteEnableError extends Error {}

/**
 * Sets `[remote] enabled = true` in config.toml via a minimal line edit that
 * preserves every other byte of the file (comments, formatting, other keys).
 * Refuses, writing nothing, when the result would not parse or would not
 * read back `remote.enabled === true` (e.g. an inline `remote = { … }` table
 * or a dotted `remote.enabled` key elsewhere, which would make an appended
 * `[remote]` header a duplicate definition).
 */
export async function enableRemoteInConfigToml(
  path: string = CONFIG_FILE,
): Promise<{ changed: boolean; path: string }> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    text = '';
  }

  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch (err) {
    throw new RemoteEnableError(
      `${displayPath(path)} does not parse, so nothing was changed: ${(err as Error).message}`,
    );
  }

  const remote = (parsed as { remote?: unknown }).remote;
  if (typeof remote === 'object' && remote !== null && (remote as { enabled?: unknown }).enabled === true) {
    return { changed: false, path };
  }

  const headerPattern = /^\s*\[\s*remote\s*\]\s*(#.*)?$/;
  const sectionPattern = /^\s*\[/;
  const enabledLinePattern = /^\s*enabled\s*=/;

  const lines = text.split('\n');
  const headerIndex = lines.findIndex((line) => headerPattern.test(line));

  let newText: string;
  if (headerIndex === -1) {
    const prefix = text.length === 0 || text.endsWith('\n') ? text : `${text}\n`;
    newText = `${prefix}\n[remote]\nenabled = true\n`;
  } else {
    let enabledIndex = -1;
    for (let i = headerIndex + 1; i < lines.length; i++) {
      if (sectionPattern.test(lines[i]!)) break;
      if (enabledLinePattern.test(lines[i]!)) {
        enabledIndex = i;
        break;
      }
    }
    const next = [...lines];
    if (enabledIndex === -1) {
      next.splice(headerIndex + 1, 0, 'enabled = true');
    } else {
      next[enabledIndex] = 'enabled = true';
    }
    newText = next.join('\n');
  }

  let verify: unknown;
  try {
    verify = parseToml(newText);
  } catch {
    throw new RemoteEnableError(`Could not turn on remote automatically: ${remoteEnabledHint(path)} by hand.`);
  }
  const verifyRemote = (verify as { remote?: unknown }).remote;
  if (
    typeof verifyRemote !== 'object' ||
    verifyRemote === null ||
    (verifyRemote as { enabled?: unknown }).enabled !== true
  ) {
    throw new RemoteEnableError(`Could not turn on remote automatically: ${remoteEnabledHint(path)} by hand.`);
  }

  await writeFileAtomic(path, newText, 0o644);
  return { changed: true, path };
}
