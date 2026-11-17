/**
 * Computer-use settings door (PAN-5461, PRD WI-3a): a path-scoped writer for
 * config.yaml's `computer_use.enabled`, mirroring src/lib/semgrep/settings.ts.
 * Only that one path is edited with `setIn`, so comments and every other node
 * in the file keep their text. The flag stays global-layer-only.
 */
import { readFile } from 'node:fs/promises';
import { isMap, parseDocument, type Document } from 'yaml';
import { clearConfigCache, getGlobalConfigPath } from '../config-yaml/load.js';
import { writeFileAtomic } from '../model-presets/state.js';
import { runSettingsWriteSerialized } from '../settings-api.js';

export interface ComputerUseSettingsDeps {
  configPath?: string;
}

/** Bad request input (route → 400). */
export class ComputerUseSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComputerUseSettingsValidationError';
  }
}

/** ~/.overdeck/config.yaml has a YAML syntax error (route → 422). */
export class ComputerUseConfigSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComputerUseConfigSyntaxError';
  }
}

function resolveConfigPath(deps: ComputerUseSettingsDeps | undefined): string {
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

function assertNoSyntaxError(doc: Document): void {
  if (doc.errors.length > 0) {
    throw new ComputerUseConfigSyntaxError(`~/.overdeck/config.yaml has a YAML syntax error: ${doc.errors[0]!.message}`);
  }
}

function viewFromDocument(doc: Document): { enabled: boolean } {
  assertNoSyntaxError(doc);
  const block = (doc.toJS() as { computer_use?: { enabled?: unknown } } | null)?.computer_use;
  return { enabled: typeof block === 'object' && block !== null && block.enabled === true };
}

/** Reads `computer_use.enabled`. A missing config.yaml reads as off. */
export async function readComputerUseSettings(deps?: ComputerUseSettingsDeps): Promise<{ enabled: boolean }> {
  return viewFromDocument(await readConfigDocument(resolveConfigPath(deps)));
}

/**
 * Writes `computer_use.enabled`. `input` must be exactly `{ enabled: boolean }`.
 * Runs inside `runSettingsWriteSerialized` and re-reads the file so the edit
 * lands on the latest text. Throws without writing on bad input or a YAML
 * syntax error.
 */
export function saveComputerUseSettings(input: unknown, deps?: ComputerUseSettingsDeps): Promise<{ enabled: boolean }> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ComputerUseSettingsValidationError('body must be an object: { enabled: boolean }');
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'enabled') {
    throw new ComputerUseSettingsValidationError('body must have exactly one key, enabled');
  }
  const enabled = (input as { enabled: unknown }).enabled;
  if (typeof enabled !== 'boolean') {
    throw new ComputerUseSettingsValidationError('enabled must be a boolean');
  }

  const path = resolveConfigPath(deps);
  return runSettingsWriteSerialized(async () => {
    const doc = await readConfigDocument(path);
    assertNoSyntaxError(doc);
    if (!isMap(doc.getIn(['computer_use']))) doc.setIn(['computer_use'], doc.createNode({}));
    doc.setIn(['computer_use', 'enabled'], enabled);
    await writeFileAtomic(path, doc.toString({ lineWidth: 120 }), 0o600);
    clearConfigCache();
    return viewFromDocument(doc);
  });
}
