import { describe, expect, it } from 'vitest';

import { mergeConfigs } from '../config-yaml/merge.js';
import { configuredOllamaModels } from '../ollama-usage.js';

describe('configuredOllamaModels', () => {
  it('finds nothing in a config that names no local model', () => {
    expect(configuredOllamaModels(mergeConfigs().config)).toEqual([]);
  });

  it('collects ollama: ids from workhorses, role models, autonomous models, and sub-roles', () => {
    const { config } = mergeConfigs({
      workhorses: { expensive: 'ollama:gemma4:12b' },
      roles: {
        work: { model: 'ollama:qwen3:14b' },
        plan: { model: 'claude-opus-5', autonomousModel: 'ollama:gemma4:12b' },
        review: { model: 'claude-sonnet-5', sub: { correctness: { model: 'ollama:devstral:24b' } } },
      },
    });

    expect(configuredOllamaModels(config).sort()).toEqual([
      'ollama:devstral:24b',
      'ollama:gemma4:12b',
      'ollama:qwen3:14b',
    ]);
  });

  it('reads each entry of a role model distribution', () => {
    const { config } = mergeConfigs({
      roles: {
        work: {
          model: [
            { model: 'claude-opus-5', weight: 1 },
            { model: 'ollama:gemma4:12b', weight: 1 },
          ],
        },
      },
    });

    expect(configuredOllamaModels(config)).toEqual(['ollama:gemma4:12b']);
  });
});
