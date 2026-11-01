/**
 * This machine's explicitly set `config.yaml` values, flattened for Compare
 * settings (PAN-4651 FR-9, D-4651-20).
 *
 * `readResolvedSettings()` parses `${OVERDECK_HOME}/config.yaml` and flattens
 * it to dotted keys exactly as written (`resources.quality_gate_slots`), which
 * is what `pan admin config set` takes. Arrays and empty maps are leaves.
 * Each value is its YAML flow form (`3`, `true`, `[a, b]`, `hello`). A key is
 * secret when any segment looks like a secret name (`isSecretKeyName`) or it
 * starts with `api_keys.`: a secret is reported only as set or not set, never
 * its value. Only explicitly set keys appear; defaults never do. A missing or
 * unparsable file reads as no settings.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse, stringify } from 'yaml';

import { isSecretKeyName } from './diagnostics/redact.js';
import { getOverdeckHome } from './paths.js';

export type ResolvedSetting = { value: string } | { secret: true; set: boolean };

export function isSecretSettingKey(key: string): boolean {
  return key.startsWith('api_keys.') || key.split('.').some((segment) => isSecretKeyName(segment));
}

/** A leaf value in YAML flow form, one line. */
export function yamlFlowValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  return stringify(value, { collectionStyle: 'flow', lineWidth: 0 }).trim();
}

function isPlainMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

export function flattenSettings(doc: unknown): Record<string, ResolvedSetting> {
  const out: Record<string, ResolvedSetting> = {};
  const visit = (value: unknown, path: string[]): void => {
    if (isPlainMap(value) && Object.keys(value).length > 0) {
      for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
      return;
    }
    if (path.length === 0) return;
    const key = path.join('.');
    out[key] = isSecretSettingKey(key)
      ? { secret: true, set: value !== null && value !== undefined && value !== '' }
      : { value: yamlFlowValue(value) };
  };
  visit(doc, []);
  return out;
}

export async function readResolvedSettings(path: string = join(getOverdeckHome(), 'config.yaml')): Promise<Record<string, ResolvedSetting>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return {};
  }
  try {
    return flattenSettings(parse(text));
  } catch {
    return {};
  }
}
