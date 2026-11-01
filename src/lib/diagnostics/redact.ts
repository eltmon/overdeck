/**
 * Redaction for `pan diagnose` bundles (PAN-4643 FR-6, FR-7, D13).
 *
 * `redactConfigYaml` runs a line-based, key-name pass over YAML config before
 * the shape-based `redactSensitiveText` (src/lib/secret-redaction.ts) runs,
 * because `LABELLED_SECRET_PATTERN` there requires a word boundary after the
 * key name and so misses `linear_api_key:` / `github_token:` style keys.
 */

import { redactSensitiveText } from '../secret-redaction.js';

const YAML_KEY_LINE = /^(\s*(?:-\s+)?)(["']?)([A-Za-z0-9_.-]+)\2(\s*:\s*)(.*)$/;
const BLOCK_SCALAR_INDICATOR = /^[|>][-+\d]*\s*$/;
const SECRET_KEY_SUBSTRINGS = [
  'api_key',
  'apikey',
  'api-key',
  'token',
  'secret',
  'password',
  'passwd',
  'credential',
  'private_key',
  'private-key',
  'cookie',
];

/** True when a config key name looks like it holds a secret (also used by PAN-4651 Compare settings). */
export function isSecretKeyName(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEY_SUBSTRINGS.some((substring) => lower.includes(substring));
}

function isRedactableValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('$')) return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return false;
  if (/^(true|false|null|~)$/i.test(trimmed)) return false;
  return true;
}

function lineIndent(line: string): number {
  return line.match(/^(\s*)/)?.[1].length ?? 0;
}

export function redactConfigYaml(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let blockIndent: number | null = null;

  for (const line of lines) {
    if (blockIndent !== null) {
      if (line.trim() === '' || lineIndent(line) > blockIndent) {
        continue;
      }
      blockIndent = null;
    }

    const match = line.match(YAML_KEY_LINE);
    if (match) {
      const [, prefix, quote, key, sep, rawValue] = match;
      if (isSecretKeyName(key)) {
        const value = rawValue.trim();
        if (BLOCK_SCALAR_INDICATOR.test(value)) {
          result.push(`${prefix}${quote}${key}${quote}${sep}[REDACTED]`);
          blockIndent = lineIndent(line);
          continue;
        }
        if (isRedactableValue(value)) {
          result.push(`${prefix}${quote}${key}${quote}${sep}[REDACTED]`);
          continue;
        }
      }
    }

    result.push(line);
  }

  return result.join('\n');
}

export function redactBundleText(text: string, options: { kind: 'text' | 'config'; home?: string }): string {
  const afterKeyName = options.kind === 'config' ? redactConfigYaml(text) : text;
  const afterShapes = redactSensitiveText(afterKeyName);
  return options.home ? afterShapes.split(options.home).join('~') : afterShapes;
}

export function countRedactions(text: string): number {
  const marker = '[REDACTED';
  let count = 0;
  let index = 0;
  for (;;) {
    const found = text.indexOf(marker, index);
    if (found === -1) break;
    count++;
    index = found + marker.length;
  }
  return count;
}
