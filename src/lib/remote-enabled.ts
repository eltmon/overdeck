/**
 * `remote.enabled` lives only in config.toml `[remote]` (PAN-4905). config.yaml's
 * `remote:` section holds resiliency_tier and max_concurrent_agents only.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { parse } from 'yaml';
import { CONFIG_FILE } from './paths.js';
import { getGlobalConfigPath } from './config-yaml/load.js';

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
