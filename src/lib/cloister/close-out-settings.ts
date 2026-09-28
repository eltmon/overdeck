/**
 * Close-out settings (dashboard-facing)
 *
 * Narrow read/write for the `[close_out]` table in ~/.overdeck/cloister.toml,
 * separate from the clobbering `PUT /api/cloister/config` path
 * (`saveCloisterConfigSync` in config.ts, which stringifies the whole merged
 * config). `writeCloseOutSetting` here parses the raw file, sets exactly one
 * key, and writes the raw object back — it never materializes defaults into
 * the file.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import { parse, stringify } from '@iarna/toml';
import { join } from 'path';
import { OVERDECK_HOME } from '../paths.js';
import { DEFAULT_CLOISTER_CONFIG, type CloseOutConfig } from './config.js';

const CLOSE_OUT_DEFAULTS: CloseOutConfig = DEFAULT_CLOISTER_CONFIG.close_out as CloseOutConfig;

const CLOISTER_CONFIG_FILE = join(OVERDECK_HOME, 'cloister.toml');

export type CloseOutKey = 'remove_workspace' | 'delete_feature_branch' | 'auto' | 'auto_delay_minutes';
export type CloseOutSource = 'default' | 'cloister.toml';

export interface CloseOutSettingView<T> {
  value: T;
  source: CloseOutSource;
  inert?: true;
}

export interface CloseOutSettingsView {
  remove_workspace: CloseOutSettingView<boolean>;
  delete_feature_branch: CloseOutSettingView<boolean>;
  auto: CloseOutSettingView<boolean>;
  auto_delay_minutes: CloseOutSettingView<number>;
}

/** Keys `PUT /api/cloister/close-out` accepts. `auto`/`auto_delay_minutes` are inert since PAN-3917. */
export const WRITABLE_CLOSE_OUT_KEYS = ['remove_workspace', 'delete_feature_branch'] as const;

const ALL_CLOSE_OUT_KEYS: CloseOutKey[] = ['remove_workspace', 'delete_feature_branch', 'auto', 'auto_delay_minutes'];
const INERT_CLOSE_OUT_KEYS: ReadonlySet<CloseOutKey> = new Set(['auto', 'auto_delay_minutes']);

export class CloseOutSettingsError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409
  ) {
    super(message);
  }
}

async function readRawConfig(configFile: string): Promise<Record<string, unknown>> {
  let content: string;
  try {
    content = await readFile(configFile, 'utf-8');
  } catch {
    return {};
  }
  try {
    return parse(content) as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function readCloseOutSettings(configFile = CLOISTER_CONFIG_FILE): Promise<CloseOutSettingsView> {
  const raw = await readRawConfig(configFile);
  const rawCloseOut = (raw.close_out ?? {}) as Record<string, unknown>;

  const view = {} as CloseOutSettingsView;
  for (const key of ALL_CLOSE_OUT_KEYS) {
    const hasOwn = Object.hasOwn(rawCloseOut, key);
    const value = hasOwn ? rawCloseOut[key] : CLOSE_OUT_DEFAULTS[key];
    const setting: CloseOutSettingView<unknown> = {
      value,
      source: hasOwn ? 'cloister.toml' : 'default',
    };
    if (INERT_CLOSE_OUT_KEYS.has(key)) {
      setting.inert = true;
    }
    (view as Record<CloseOutKey, CloseOutSettingView<unknown>>)[key] = setting;
  }
  return view;
}

export async function writeCloseOutSetting(
  key: unknown,
  value: unknown,
  configFile = CLOISTER_CONFIG_FILE
): Promise<CloseOutSettingsView> {
  if (typeof key !== 'string' || !(WRITABLE_CLOSE_OUT_KEYS as readonly string[]).includes(key)) {
    const message =
      key === 'auto' || key === 'auto_delay_minutes'
        ? `${String(key)} is inert since PAN-3917 and cannot be set`
        : `${String(key)} is not writable from the dashboard`;
    throw new CloseOutSettingsError(message, 400);
  }
  if (typeof value !== 'boolean') {
    throw new CloseOutSettingsError(`${key} must be a boolean`, 400);
  }

  let content: string;
  try {
    content = await readFile(configFile, 'utf-8');
  } catch {
    content = '';
  }

  let raw: Record<string, unknown> = {};
  if (content.trim().length > 0) {
    try {
      raw = parse(content) as unknown as Record<string, unknown>;
    } catch {
      throw new CloseOutSettingsError(
        'cloister.toml does not parse; fix it by hand before saving from the dashboard',
        409
      );
    }
  }

  raw.close_out = { ...((raw.close_out as Record<string, unknown>) ?? {}), [key]: value };

  await mkdir(OVERDECK_HOME, { recursive: true });
  await writeFile(configFile, stringify(raw as unknown as Parameters<typeof stringify>[0]), 'utf-8');

  return readCloseOutSettings(configFile);
}
