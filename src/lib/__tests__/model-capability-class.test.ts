import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { MODEL_CAPABILITIES, MODEL_DEPRECATIONS } from '../model-capabilities.js';
import { PROVIDERS } from '../providers.js';
import { MODEL_CAPABILITY_CLASSES, capabilityClassOf } from '../model-capability-class.js';

/** Ids in PROVIDERS[*].models with no resolvable capability class. */
function missingCatalogIds(table: Readonly<Record<string, string>>): string[] {
  const missing: string[] = [];
  for (const provider of Object.values(PROVIDERS)) {
    for (const id of provider.models) {
      const resolved = MODEL_DEPRECATIONS[id] ?? id;
      if (table[resolved] === undefined) missing.push(id);
    }
  }
  return missing;
}

describe('MODEL_CAPABILITY_CLASSES', () => {
  it('classifies every id in PROVIDERS[*].models', () => {
    const missing = missingCatalogIds(MODEL_CAPABILITY_CLASSES);
    expect(missing, `catalog ids missing a capability class: ${missing.join(', ')}`).toEqual([]);
  });

  it('classifies every non-deprecated MODEL_CAPABILITIES key', () => {
    const missing = Object.entries(MODEL_CAPABILITIES)
      .filter(([id, cap]) => !cap.displayName.includes('(deprecated)') && !(id in MODEL_DEPRECATIONS))
      .map(([id]) => id)
      .filter((id) => capabilityClassOf(id) === undefined);
    expect(missing, `capability ids missing a class: ${missing.join(', ')}`).toEqual([]);
  });

  it('fails loudly when a catalog id loses its class', () => {
    const removedId = PROVIDERS.anthropic.models[0];
    const table: Record<string, string> = { ...MODEL_CAPABILITY_CLASSES };
    delete table[MODEL_DEPRECATIONS[removedId] ?? removedId];
    const missing = missingCatalogIds(table);
    const message = `catalog ids missing a capability class: ${missing.join(', ')}`;
    expect(missing.length).toBeGreaterThan(0);
    expect(message).toContain(removedId);
  });
});

describe('capabilityClassOf', () => {
  it('resolves a deprecated alias to its replacement class', () => {
    expect(capabilityClassOf('gpt-5.5')).toBe('frontier');
    expect(capabilityClassOf('gpt-5.5')).toBe(capabilityClassOf('gpt-5.6-sol'));
  });

  it('returns undefined for an opencode-namespaced id', () => {
    expect(capabilityClassOf('opencode/anything')).toBeUndefined();
  });
});

describe('module purity', () => {
  it('exports exactly the table and the resolver', async () => {
    expect(Object.keys(await import('../model-capability-class.js'))).toEqual([
      'MODEL_CAPABILITY_CLASSES',
      'capabilityClassOf',
    ]);
  });

  it('has no node or effect imports', () => {
    const source = readFileSync(fileURLToPath(new URL('../model-capability-class.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/from '(fs|path|effect)'/);
    expect(source).not.toContain('model-capabilities.js');
  });
});
