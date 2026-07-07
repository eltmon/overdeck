import { describe, expect, it } from 'vitest';
import { mergeConfigs } from '../merge.js';
import type { YamlConfig } from '../schema.js';

describe('planning.default_mode config (PAN-2407)', () => {
  it('round-trips default_mode from YAML to normalized config', () => {
    const config = {
      planning: {
        default_mode: 'interactive',
      },
    } as unknown as YamlConfig;

    const { config: normalized } = mergeConfigs(config);

    expect(normalized.planning).toEqual({ defaultMode: 'interactive' });
  });

  it('round-trips all valid planning modes', () => {
    for (const mode of ['interactive', 'auto', 'skip'] as const) {
      const config = {
        planning: {
          default_mode: mode,
        },
      } as unknown as YamlConfig;

      const { config: normalized } = mergeConfigs(config);

      expect(normalized.planning).toEqual({ defaultMode: mode });
    }
  });

  it('leaves planning undefined when the section is absent', () => {
    const config = {} as unknown as YamlConfig;

    const { config: normalized } = mergeConfigs(config);

    expect(normalized.planning).toBeUndefined();
  });
});
