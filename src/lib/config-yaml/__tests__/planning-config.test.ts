import { describe, expect, it } from 'vitest';
import { mergeConfigs } from '../merge.js';
import { DEFAULT_ROLES } from '../roles.js';
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

describe('roles.plan.autonomousModel config', () => {
  it('round-trips a scalar workhorse reference', () => {
    const config = {
      roles: {
        plan: {
          autonomousModel: 'workhorse:cheap',
        },
      },
    } as unknown as YamlConfig;

    const { config: normalized } = mergeConfigs(config);

    expect(normalized.roles?.plan?.autonomousModel).toBe('workhorse:cheap');
  });

  it('does not inject an autonomous planning model by default', () => {
    const { config: normalized } = mergeConfigs({} as YamlConfig);

    expect(normalized.roles?.plan?.autonomousModel).toBeUndefined();
    expect(DEFAULT_ROLES.plan).not.toHaveProperty('autonomousModel');
  });

  it('rejects a dangling workhorse reference with the field path', () => {
    const config = {
      roles: {
        plan: {
          autonomousModel: 'workhorse:nonexistent',
        },
      },
    } as unknown as YamlConfig;

    expect(() => mergeConfigs(config)).toThrow('roles.plan.autonomousModel');
  });

  it('rejects a model distribution', () => {
    const config = {
      roles: {
        plan: {
          autonomousModel: [{ model: 'workhorse:cheap', weight: 100 }],
        },
      },
    } as unknown as YamlConfig;

    expect(() => mergeConfigs(config)).toThrow(
      'roles.plan.autonomousModel must be a scalar model reference',
    );
  });
});
