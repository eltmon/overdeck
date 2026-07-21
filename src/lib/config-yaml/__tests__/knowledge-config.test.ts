import { describe, expect, it } from 'vitest';
import { mergeConfigs } from '../merge.js';

describe('knowledge.post_merge_auto_retro config', () => {
  it('defaults post-merge auto retro off', () => {
    const { config } = mergeConfigs({});
    expect(config.knowledge.postMergeAutoRetro).toBe(false);
  });

  it('round-trips the opt-in post-merge auto retro flag', () => {
    const { config } = mergeConfigs({
      knowledge: {
        post_merge_auto_retro: true,
      },
    });
    expect(config.knowledge.postMergeAutoRetro).toBe(true);
  });
});
