import { describe, expect, it } from 'vitest';
import type { FeatureRegistryEntry } from '@overdeck/contracts';
import { getFeatureRegistryListPayload } from '../feature-registry.js';

function makeEntry(): FeatureRegistryEntry {
  return {
    featureId: 'feature-1',
    featureName: 'context-distribution',
    description: null,
    owningWorkspaceId: 'feature-pan-1204',
    owningIssueId: 'PAN-1204',
    owningAgentId: 'agent-pan-1204',
    status: 'active',
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    tags: ['briefing'],
  };
}

describe('feature registry route payload', () => {
  it('lists registry entries through the async dashboard registry service boundary', async () => {
    const entry = makeEntry();
    const calls: unknown[] = [];

    await expect(getFeatureRegistryListPayload({
      listEntries: async (filter) => {
        calls.push(filter);
        return [entry];
      },
    })).resolves.toEqual({ entries: [entry] });

    expect(calls).toEqual([{ limit: 100 }]);
  });
});
