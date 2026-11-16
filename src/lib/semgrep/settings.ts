/**
 * Semgrep settings read/write door (PAN-4594): a path-scoped write door for config.yaml's
 * `security.semgrep` block, mirroring `src/lib/jev/settings.ts` — only the named
 * `security.semgrep.*` paths are edited with `setIn`, so comments and every other node in
 * the file keep their text untouched.
 */
import { readFile } from 'node:fs/promises';
import { isMap, parseDocument, type Document } from 'yaml';
import { clearConfigCache, getGlobalConfigPath } from '../config-yaml/load.js';
import {
  DEFAULT_NORMALIZED_SECURITY,
  normalizeSecurityConfig,
  type NormalizedSemgrepConfig,
  type YamlSecurityConfig,
} from '../config-yaml/semgrep.js';
import { writeFileAtomic } from '../model-presets/state.js';
import { runSettingsWriteSerialized } from '../settings-api.js';
import { SEMGREP_VERSION } from './install.js';

export const SEMGREP_SETTINGS_KEYS = ['enabled', 'mcp', 'edit_hook', 'gate', 'severity', 'configs', 'timeout_seconds'] as const;
export type SemgrepSettingsKey = (typeof SEMGREP_SETTINGS_KEYS)[number];
export type SemgrepSettingsPatch = Partial<Pick<NormalizedSemgrepConfig, SemgrepSettingsKey>>;

export interface SemgrepSettingsView extends NormalizedSemgrepConfig {
  /** SEMGREP_VERSION from src/lib/semgrep/install.ts. */
  pinnedVersion: string;
}

export interface SemgrepSettingsDeps {
  configPath?: string;
}

export class SemgrepSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SemgrepSettingsValidationError';
  }
}

function resolveConfigPath(deps: SemgrepSettingsDeps | undefined): string {
  return deps?.configPath ?? getGlobalConfigPath();
}

async function readConfigDocument(path: string): Promise<Document> {
  try {
    return parseDocument(await readFile(path, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return parseDocument('');
    throw err;
  }
}

/** Reads the `security.semgrep:` block out of a parsed config.yaml document. */
function viewFromDocument(doc: Document): SemgrepSettingsView {
  if (doc.errors.length > 0) {
    throw new SemgrepSettingsValidationError(`~/.overdeck/config.yaml has a YAML syntax error: ${doc.errors[0]!.message}`);
  }
  const raw = (doc.toJS() as { security?: unknown } | null)?.security;
  let semgrep: NormalizedSemgrepConfig;
  try {
    semgrep = normalizeSecurityConfig(raw as YamlSecurityConfig, DEFAULT_NORMALIZED_SECURITY).semgrep;
  } catch (err) {
    throw new SemgrepSettingsValidationError(err instanceof Error ? err.message : String(err));
  }
  return { ...semgrep, configs: [...semgrep.configs], pinnedVersion: SEMGREP_VERSION };
}

/** Reads the current Semgrep settings for the Security section. A missing config.yaml reads as defaults. */
export async function readSemgrepSettings(deps?: SemgrepSettingsDeps): Promise<SemgrepSettingsView> {
  const doc = await readConfigDocument(resolveConfigPath(deps));
  return viewFromDocument(doc);
}

function ensureMap(doc: Document, path: readonly string[]): void {
  if (!isMap(doc.getIn(path))) doc.setIn(path, doc.createNode({}));
}

/**
 * Validates and writes a settings-form patch to config.yaml's `security.semgrep` block. Runs
 * inside `runSettingsWriteSerialized` so a concurrent writer can't interleave, and re-reads the
 * file so the edit lands on the latest text rather than a stale in-memory copy. Throws
 * `SemgrepSettingsValidationError` without writing when validation fails.
 */
export function saveSemgrepSettings(input: unknown, deps?: SemgrepSettingsDeps): Promise<SemgrepSettingsView> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new SemgrepSettingsValidationError('body must be an object of security.semgrep keys');
  }
  const patch = input as Record<string, unknown>;
  const patchKeys = Object.keys(patch);
  for (const key of patchKeys) {
    if (!(SEMGREP_SETTINGS_KEYS as readonly string[]).includes(key)) {
      throw new SemgrepSettingsValidationError(`unknown key security.semgrep.${key}`);
    }
  }
  if (patchKeys.length === 0) {
    throw new SemgrepSettingsValidationError('nothing to save');
  }

  const path = resolveConfigPath(deps);
  return runSettingsWriteSerialized(async () => {
    const doc = await readConfigDocument(path);
    if (doc.errors.length > 0) {
      throw new SemgrepSettingsValidationError(
        `~/.overdeck/config.yaml has a YAML syntax error: ${doc.errors[0]!.message}`,
      );
    }

    const rawCurrent = (doc.toJS() as { security?: { semgrep?: unknown } } | null)?.security?.semgrep;
    const current = typeof rawCurrent === 'object' && rawCurrent !== null && !Array.isArray(rawCurrent) ? rawCurrent : {};
    const candidate = { ...current, ...patch };

    let normalized: NormalizedSemgrepConfig;
    try {
      normalized = normalizeSecurityConfig({ semgrep: candidate } as YamlSecurityConfig, DEFAULT_NORMALIZED_SECURITY).semgrep;
    } catch (err) {
      throw new SemgrepSettingsValidationError(err instanceof Error ? err.message : String(err));
    }

    ensureMap(doc, ['security']);
    ensureMap(doc, ['security', 'semgrep']);
    for (const key of patchKeys as SemgrepSettingsKey[]) {
      const value = key === 'configs' ? doc.createNode(normalized.configs) : patch[key];
      doc.setIn(['security', 'semgrep', key], value);
    }

    await writeFileAtomic(path, doc.toString({ lineWidth: 120 }), 0o600);
    clearConfigCache();
    return viewFromDocument(doc);
  });
}
