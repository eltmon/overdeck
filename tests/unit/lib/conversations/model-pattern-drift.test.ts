import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MODEL_ID_PATTERN } from '../../../../src/lib/model-validation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..', '..');

// PAN-2979: these files once carried a stale local copy of the model-id
// pattern that predated the square-bracket context suffix, so launching
// `k3[1m]` failed with "Invalid model" while the canonical validator
// accepted it. They must validate models through model-validation.ts.
const CONVERSATION_MODEL_VALIDATION_FILES = [
  'src/lib/overdeck/conversation-runtime.ts',
  'src/lib/overdeck/conversation-forks.ts',
] as const;

describe('PAN-2979 conversation model-pattern drift guard', () => {
  it('accepts the bracket context suffix in the canonical pattern', () => {
    expect(MODEL_ID_PATTERN.test('k3[1m]')).toBe(true);
    expect(MODEL_ID_PATTERN.test('k3')).toBe(true);
    // Shell metacharacters and whitespace stay rejected.
    expect(MODEL_ID_PATTERN.test('k3; rm -rf /')).toBe(false);
    expect(MODEL_ID_PATTERN.test('k3 $(id)')).toBe(false);
    expect(MODEL_ID_PATTERN.test("k3'`")).toBe(false);
  });

  it.each(CONVERSATION_MODEL_VALIDATION_FILES)('%s imports the canonical pattern instead of defining its own', (file) => {
    const content = readFileSync(join(ROOT, file), 'utf8');
    expect(content).toContain("import { MODEL_ID_PATTERN } from '../model-validation.js'");
    // A fresh regex literal assigned to the model pattern is the drift that
    // caused PAN-2979 — the alias must point at the canonical constant.
    expect(content).toMatch(/const SAFE_MODEL_PATTERN = MODEL_ID_PATTERN;/);
    expect(content).not.toMatch(/const SAFE_MODEL_PATTERN = \/\^/);
  });
});
