/**
 * Jev settings read/write door (PAN-4508): a path-scoped write door for config.yaml's
 * `jev:` block, mirroring the pattern in `model-presets/apply.ts` — only `jev.*` paths
 * are edited with `setIn`/`deleteIn`; every other node in the file (comments, unrelated
 * top-level keys, api_key_ref) keeps its text untouched.
 */
import { readFile } from 'node:fs/promises';
import { isMap, parseDocument, type Document } from 'yaml';
import { clearConfigCache, getGlobalConfigPath, loadConfigSync } from '../config-yaml/load.js';
import { DEFAULT_JEV_API_KEY_REF, DEFAULT_JEV_TIMEOUT_MS } from '../config-yaml/jev.js';
import { writeFileAtomic } from '../model-presets/state.js';
import { runSettingsWriteSerialized } from '../settings-api.js';
import { resetJevMemo } from './memo.js';
import { JEV_ZEN_BASE_URL, routeForBaseUrl, validateJevSettingsInput, type JevRoute } from './settings-validation.js';

export interface JevSettingsDeps {
  configPath?: string;
}

export interface JevSettingsView {
  configured: boolean;
  route: JevRoute;
  baseUrl?: string;
  model?: string;
  timeoutMs: number;
  apiKeyRef: string;
}

export class JevSettingsValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('; '));
    this.name = 'JevSettingsValidationError';
  }
}

function resolveConfigPath(deps: JevSettingsDeps | undefined): string {
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

/** Deletes a leaf only when its parent is already a map; a missing parent means the leaf is already absent. */
function deleteLeafIfParentExists(doc: Document, path: [string, string]): void {
  if (isMap(doc.getIn([path[0]]))) doc.deleteIn(path);
}

/** Reads the `jev:` block out of a parsed config.yaml document. No block → unconfigured defaults. */
export function jevSettingsFromDocument(doc: Document): JevSettingsView {
  const jevNode = doc.getIn(['jev']);
  if (!isMap(jevNode)) {
    return { configured: false, route: 'direct', timeoutMs: DEFAULT_JEV_TIMEOUT_MS, apiKeyRef: DEFAULT_JEV_API_KEY_REF };
  }
  const rawBaseUrl = doc.getIn(['jev', 'base_url']);
  const baseUrl = typeof rawBaseUrl === 'string' ? rawBaseUrl : undefined;
  const rawModel = doc.getIn(['jev', 'model']);
  const model = typeof rawModel === 'string' ? rawModel : undefined;
  const rawTimeoutMs = doc.getIn(['jev', 'timeout_ms']);
  const timeoutMs = typeof rawTimeoutMs === 'number' ? rawTimeoutMs : DEFAULT_JEV_TIMEOUT_MS;
  const rawApiKeyRef = doc.getIn(['jev', 'api_key_ref']);
  const apiKeyRef = typeof rawApiKeyRef === 'string' && rawApiKeyRef.trim() ? rawApiKeyRef : DEFAULT_JEV_API_KEY_REF;
  return { configured: true, route: routeForBaseUrl(baseUrl), baseUrl, model, timeoutMs, apiKeyRef };
}

/** Reads the current Jev settings for the settings panel. A missing config.yaml reads as unconfigured defaults. */
export async function readJevSettings(deps?: JevSettingsDeps): Promise<JevSettingsView> {
  const doc = await readConfigDocument(resolveConfigPath(deps));
  return jevSettingsFromDocument(doc);
}

/**
 * Validates and writes a settings-form edit to config.yaml's `jev:` block. Runs inside
 * `runSettingsWriteSerialized` so a concurrent writer can't interleave, and re-reads the
 * file so the edit lands on the latest text rather than a stale in-memory copy. Throws
 * `JevSettingsValidationError` without writing when validation fails.
 */
export function saveJevSettings(input: unknown, deps?: JevSettingsDeps): Promise<JevSettingsView> {
  const path = resolveConfigPath(deps);
  return runSettingsWriteSerialized(async () => {
    const doc = await readConfigDocument(path);
    clearConfigCache();
    const features = loadConfigSync().config.backgroundAi.features;
    const rawBaseUrl = doc.getIn(['jev', 'base_url']);
    const currentBaseUrl = typeof rawBaseUrl === 'string' ? rawBaseUrl : undefined;

    const result = validateJevSettingsInput(input, { baseUrl: currentBaseUrl, features });
    if (!result.ok) throw new JevSettingsValidationError(result.errors);

    switch (result.value.route) {
      case 'zen':
        doc.setIn(['jev', 'base_url'], JEV_ZEN_BASE_URL);
        break;
      case 'direct':
        deleteLeafIfParentExists(doc, ['jev', 'base_url']);
        break;
      case 'custom':
        break;
    }
    if (result.value.model) {
      doc.setIn(['jev', 'model'], result.value.model);
    } else {
      deleteLeafIfParentExists(doc, ['jev', 'model']);
    }
    doc.setIn(['jev', 'timeout_ms'], result.value.timeoutMs);

    await writeFileAtomic(path, doc.toString({ lineWidth: 120 }), 0o600);
    clearConfigCache();
    resetJevMemo();
    return jevSettingsFromDocument(doc);
  });
}
