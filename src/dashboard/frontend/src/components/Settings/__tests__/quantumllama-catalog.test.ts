import { describe, it, expect } from 'vitest';

import { MODELS_BY_PROVIDER } from '../modelCatalog';
import { friendlyModelName as costFriendlyModelName } from '../../CostBreakdownModal';
import { friendlyModelName as timelineFriendlyModelName } from '../../Stage/HomePane/Timeline';

describe('QuantumLlama dashboard visibility (PAN-3252)', () => {
  it('exposes a QuantumLlama provider group with spec names and blended costs', () => {
    const group = MODELS_BY_PROVIDER.quantumllama;
    expect(group).toBeDefined();
    expect(group.name).toBe('QuantumLlama');

    const byId = Object.fromEntries(group.models.map((m) => [m.id, m]));
    expect(byId['ql-reason-70b'].name).toBe('QL Reason 70B');
    expect(byId['ql-reason-70b'].costPer1MTokens).toBe(16);
    expect(byId['ql-swift-8b'].name).toBe('QL Swift 8B');
    expect(byId['ql-swift-8b'].costPer1MTokens).toBe(4);
    expect(byId['ql-nano-1b'].name).toBe('QL Nano 1B');
    expect(byId['ql-nano-1b'].costPer1MTokens).toBe(0.8);
  });

  it('cost breakdown friendlyModelName maps ql-* ids to their spec names', () => {
    expect(costFriendlyModelName('ql-reason-70b')).toBe('QL Reason 70B');
    expect(costFriendlyModelName('ql-swift-8b')).toBe('QL Swift 8B');
    expect(costFriendlyModelName('ql-nano-1b')).toBe('QL Nano 1B');
    // Non-QL models keep the generic heuristic rendering.
    expect(costFriendlyModelName('claude-sonnet-4-6')).toBe('Sonnet 4 6');
  });

  it('timeline friendlyModelName maps ql-* ids to their spec names', () => {
    expect(timelineFriendlyModelName('ql-swift-8b')).toBe('QL Swift 8B');
    expect(timelineFriendlyModelName('gpt-5.4')).toBe('Gpt 5.4');
  });
});
