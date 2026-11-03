/**
 * `pan admin config set <key> <value>` (PAN-4651 FR-9, D-4651-21).
 *
 * Writes one value into `~/.overdeck/config.yaml`, keeping comments and every
 * other block. `<key>` is a dotted snake_case path (`resources.quality_gate_slots`);
 * `<value>` is parsed as YAML, so `3` is a number, `true` a boolean and
 * `[a, b]` a list. After the write the config is loaded again; if loading
 * fails, the previous file text is restored and the error is printed. This is
 * the command Compare settings prints for each difference.
 *
 * `remote.enabled` refuses (PAN-4905): it lives only in config.toml `[remote]`,
 * so writing it into config.yaml would be a silent no-op.
 */
import { readFile, unlink, writeFile } from 'node:fs/promises';

import type { Command } from 'commander';
import { parse, parseDocument } from 'yaml';

import { clearConfigCache, getGlobalConfigPath, loadConfigNoMigration } from '../../lib/config-yaml/load.js';
import { yamlFlowValue } from '../../lib/settings-resolved.js';
import { remoteEnabledHint } from '../../lib/remote-enabled.js';

export const CONFIG_KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

export interface ConfigSetDeps {
  path: () => string;
  readFile: (path: string) => Promise<string | null>;
  writeFile: (path: string, text: string) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  /** Load the config again; throws when the written file is not a valid config. */
  validate: () => Promise<void>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const defaultConfigSetDeps = (): ConfigSetDeps => ({
  path: getGlobalConfigPath,
  readFile: (path) => readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? null : Promise.reject(error))),
  writeFile: (path, text) => writeFile(path, text, 'utf8'),
  removeFile: (path) => unlink(path).catch(() => undefined),
  validate: async () => {
    clearConfigCache();
    await loadConfigNoMigration();
  },
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
});

/** Returns the exit code. */
export async function configSetCommand(key: string, rawValue: string, deps: ConfigSetDeps = defaultConfigSetDeps()): Promise<number> {
  if (!CONFIG_KEY_PATTERN.test(key)) {
    deps.stderr(`Invalid key ${JSON.stringify(key)}: use dotted snake_case, for example resources.quality_gate_slots.`);
    return 1;
  }
  if (key === 'remote.enabled') {
    deps.stderr(`remote.enabled is not a config.yaml setting, so nothing was changed: ${remoteEnabledHint()}.`);
    return 1;
  }
  let value: unknown;
  try {
    value = parse(rawValue);
  } catch (error) {
    deps.stderr(`Cannot parse ${JSON.stringify(rawValue)} as a YAML value: ${(error as Error).message}`);
    return 1;
  }
  const path = deps.path();
  const previous = await deps.readFile(path);
  const doc = parseDocument(previous && previous.trim() !== '' ? previous : '{}\n');
  if (doc.errors.length > 0) {
    deps.stderr(`${path} does not parse, so nothing was changed: ${doc.errors[0]!.message}`);
    return 1;
  }
  doc.setIn(key.split('.'), value);
  await deps.writeFile(path, doc.toString());
  try {
    await deps.validate();
  } catch (error) {
    if (previous === null) await deps.removeFile(path);
    else await deps.writeFile(path, previous);
    deps.stderr(`Not set: ${key} = ${yamlFlowValue(value)} makes the config invalid (${(error as Error).message}). ${path} is unchanged.`);
    return 1;
  }
  deps.stdout(`Set ${key} = ${yamlFlowValue(value)} in ${path}`);
  return 0;
}

export function registerConfigSetCommand(config: Command): void {
  config
    .command('set <key> <value>')
    .description('Set one config.yaml value (dotted snake_case key; the value is parsed as YAML), keeping comments')
    .action(async (key: string, value: string) => {
      const code = await configSetCommand(key, value);
      const { exitCli } = await import('../exit.js');
      await exitCli(code);
    });
}
