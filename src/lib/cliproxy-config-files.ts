/**
 * cliproxy-config-files.ts
 *
 * Async file helpers for CLIProxy's generated config (PAN-5282): the
 * management key file (`~/.overdeck/cliproxy/management-key`, mode 0600) and
 * the operator-owned `config.extra.yaml`, parsed as YAML.
 *
 * `writeCliproxyConfig` builds the v8 config (`cliproxy-config.ts`) and writes
 * `config.yaml` in place, mode 0600, only when its parsed content differs.
 *
 * Every function takes its paths as arguments; the default paths live in
 * `cliproxy.ts`. This module never imports `cliproxy.ts` (lint:circular).
 */

import { randomBytes } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { buildCliproxyConfigV8, configNeedsWrite } from './cliproxy-config.js';

/** A random management key: 24 bytes as base64url (32 characters). */
export function generateManagementKey(): string {
  return randomBytes(24).toString('base64url');
}

/** The trimmed key file contents, or null when the file is missing or empty. */
export async function readManagementKeyFile(path: string): Promise<string | null> {
  try {
    const key = (await readFile(path, 'utf8')).trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/** Write the key file with mode 0600 (chmod covers a file that already existed). */
export async function writeManagementKeyFile(path: string, key: string): Promise<void> {
  await writeFile(path, `${key}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse `config.extra.yaml`. A missing, empty, invalid or non-mapping file
 * yields `{}` so the proxy still starts; the last two are logged.
 */
export async function readConfigExtraFile(
  path: string,
  log: (message: string) => void = console.warn,
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return {};
  }
  if (text.trim().length === 0) return {};

  let value: unknown;
  try {
    value = parseYaml(text);
  } catch {
    log('[cliproxy] config.extra.yaml is not valid YAML; ignoring it');
    return {};
  }
  if (!isPlainObject(value)) {
    log('[cliproxy] config.extra.yaml is not a YAML mapping; ignoring it');
    return {};
  }
  return value;
}

export interface WriteCliproxyConfigOptions {
  configPath: string;
  extraPath: string;
  keyPath: string;
  host: string;
  port: number;
  clientToken: string;
  authDir: string;
  geminiApiKey: string | null;
  log?: (message: string) => void;
}

/**
 * Ensure `config.yaml` holds the generated v8 config. The management key file
 * always ends up holding the active plaintext key (created when missing; an
 * extra plaintext key is written back). `config.yaml` is written in place with
 * `writeFile`, never temp file plus rename: CLIProxy's hot-reload watcher
 * missed a rename in the PAN-5282 probe.
 */
export async function writeCliproxyConfig(
  opts: WriteCliproxyConfigOptions,
): Promise<{ wrote: boolean; activeManagementKey: string }> {
  const log = opts.log ?? console.warn;
  const stored = await readManagementKeyFile(opts.keyPath);
  const managementKey = stored ?? generateManagementKey();
  const extra = await readConfigExtraFile(opts.extraPath, log);
  const out = buildCliproxyConfigV8({
    host: opts.host,
    port: opts.port,
    clientToken: opts.clientToken,
    authDir: opts.authDir,
    geminiApiKey: opts.geminiApiKey,
    managementKey,
    extra,
  });
  for (const warning of out.warnings) log(`[cliproxy] ${warning}`);

  const keyChanged = out.activeManagementKey !== stored;
  if (keyChanged) await writeManagementKeyFile(opts.keyPath, out.activeManagementKey);

  let existing: string | null;
  try {
    existing = await readFile(opts.configPath, 'utf8');
  } catch {
    existing = null;
  }
  const wrote = configNeedsWrite(existing, out.config, keyChanged);
  if (wrote) await writeFile(opts.configPath, out.yaml, { mode: 0o600 });
  // writeFile applies the mode only when it creates the file.
  await chmod(opts.configPath, 0o600);

  return { wrote, activeManagementKey: out.activeManagementKey };
}
