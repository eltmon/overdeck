import { describe, it, expect } from 'vitest';

import { MODELS_BY_PROVIDER } from '../modelCatalog';
import { MODEL_EFFORT_SUPPORT } from '../../chat/ModelPicker';

describe('Claude Fable 5.2 dashboard visibility (PAN-5103)', () => {
  it('lists Fable 5.2 first in the anthropic group, ahead of Fable 5.1', () => {
    const group = MODELS_BY_PROVIDER.anthropic;
    expect(group).toBeDefined();

    expect(group.models[0]).toMatchObject({
      id: 'claude-fable-5-2',
      name: 'Claude Fable 5.2 (1M context)',
      costPer1MTokens: 24,
    });

    const fable51 = group.models.find((m) => m.id === 'claude-fable-5-1');
    expect(fable51).toBeDefined();
    expect(fable51?.description?.startsWith('Previous Fable')).toBe(true);
  });

  it('supports the full low-to-max effort range', () => {
    expect(MODEL_EFFORT_SUPPORT['claude-fable-5-2']).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
});
