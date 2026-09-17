import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { CONFIGURABLE_PROVIDERS, CONFIGURABLE_PROVIDER_SET } from '../configurable-providers.js';
import { PROVIDERS } from '../providers.js';

const readSource = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('CONFIGURABLE_PROVIDERS', () => {
  it('names only providers that exist in the real provider catalog', () => {
    const unknown = CONFIGURABLE_PROVIDERS.filter((provider) => !(provider in PROVIDERS));
    expect(unknown, `not in PROVIDERS: ${unknown.join(', ')}`).toEqual([]);
  });

  // PAN-3842 (adjudicated F-1): these reach the catalog through environment
  // variables only. No config.yaml key and no merge branch can put them in
  // enabledProviders, so a "not enabled in Settings › Providers" warning about
  // them can never be cleared.
  it.each(['xai', 'groq', 'cerebras', 'mistral', 'quantumllama'])(
    'excludes %s, which has no enable control',
    (provider) => {
      expect(provider in PROVIDERS).toBe(true);
      expect(CONFIGURABLE_PROVIDER_SET.has(provider)).toBe(false);
    },
  );

  it('matches the keys the config schema accepts under models.providers', () => {
    // The schema's Partial<Record<ConfigurableProvider, …>> is derived from
    // this list, so the type cannot drift. Assert the derivation is still wired
    // rather than re-listing the ids here.
    const schema = readSource('../config-yaml/schema.ts');
    expect(schema).toContain('Partial<Record<ConfigurableProvider, ProviderConfig | boolean>>');
    expect(schema).toContain("from '../configurable-providers.js'");
  });

  it('matches every provider the config merge can enable', () => {
    // Each configurable provider must have a branch in merge.ts that can add it
    // to enabledProviders — otherwise the toggle exists but does nothing.
    const merge = readSource('../config-yaml/merge.ts');
    const unmergeable = CONFIGURABLE_PROVIDERS.filter(
      (provider) => !merge.includes(`enabledProviders.add('${provider}')`) && !merge.includes(`'${provider}'`),
    );
    expect(unmergeable, `no merge branch enables: ${unmergeable.join(', ')}`).toEqual([]);
  });

  it('is exactly the set Settings › Providers renders a control for', () => {
    // The Settings section hand-maintains its card list; OpenRouter gets a
    // bespoke panel rather than a row in that array.
    const section = readSource(
      '../../dashboard/frontend/src/components/Settings/sections/ProviderManagementSection.tsx',
    );
    const listed = new Set(
      [...section.matchAll(/\{ id: '([a-z-]+)', name: /g)].map((match) => match[1]),
    );
    if (section.includes('formData.models.providers.openrouter')) listed.add('openrouter');
    const missingControl = CONFIGURABLE_PROVIDERS.filter((provider) => !listed.has(provider));
    expect(missingControl, `configurable but no Settings control: ${missingControl.join(', ')}`).toEqual([]);
    const strayControl = [...listed].filter((provider) => !CONFIGURABLE_PROVIDER_SET.has(provider));
    expect(strayControl, `Settings control for a non-configurable provider: ${strayControl.join(', ')}`).toEqual([]);
  });
});
