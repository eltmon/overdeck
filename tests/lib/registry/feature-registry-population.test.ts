import { describe, expect, it, vi } from 'vitest';
import type { FeatureRegistryEntry } from '@panctl/contracts';
import {
  applyIssueFeatureClassification,
  classifyIssueFeatures,
  recordIssueFeatureClassification,
  updateFeatureRegistryForLifecycle,
} from '../../../src/lib/registry/feature-registry-population.js';

const lowCostConfig = {
  enabled: true,
  provider: 'cliproxy' as const,
  model: 'gpt-4.1-nano',
  perDayCostCapUsd: 1,
};

const manualEntry: FeatureRegistryEntry = {
  featureId: 'manual-1',
  featureName: 'Manual Override',
  description: 'Human-owned tag',
  owningWorkspaceId: null,
  owningIssueId: 'PAN-1204',
  owningAgentId: null,
  status: 'active',
  createdAt: '2026-05-24T00:00:00.000Z',
  updatedAt: '2026-05-24T00:00:00.000Z',
  tags: ['manual'],
};

describe('feature registry population', () => {
  it('classifies issue features through a mockable low-cost classifier', async () => {
    const classify = vi.fn(async () => ({
      status: 'extracted' as const,
      provider: 'stub',
      result: {
        data: {
          features: [
            { featureName: 'Home Dashboard', description: 'Home surface', tags: ['Dashboard UI'] },
          ],
        },
        usage: { input: 1, output: 1 },
        cost: { usd: 0 },
        model: 'stub-model',
        provider: 'stub',
      },
    }));

    const result = await classifyIssueFeatures({
      issueId: 'PAN-1204',
      title: 'Render Home dashboard registry panel',
      body: 'Adds registry cards to the Home route.',
      config: lowCostConfig,
      classify,
    });

    expect(classify).toHaveBeenCalledOnce();
    expect(classify.mock.calls[0][0]).toContain('Render Home dashboard registry panel');
    expect(result).toEqual({
      status: 'classified',
      features: [
        { featureName: 'Home Dashboard', description: 'Home surface', tags: ['dashboard-ui'] },
      ],
    });
  });

  it('returns failure instead of throwing when issue classification fails', async () => {
    const result = await recordIssueFeatureClassification({
      issueId: 'PAN-1204',
      title: 'Broken classifier',
      body: null,
      config: lowCostConfig,
      classify: async () => {
        throw new Error('provider down');
      },
    });

    expect(result).toEqual({ status: 'failed', reason: 'extraction-failed', features: [] });
  });

  it('does not overwrite existing manual registry tags with classifier output', async () => {
    const tagIssue = vi.fn(async (input) => ({
      ...manualEntry,
      featureId: `feature-${input.featureName}`,
      featureName: input.featureName,
      description: input.description ?? null,
      tags: input.tags ?? [],
    }));

    await applyIssueFeatureClassification({
      issueId: 'PAN-1204',
      title: 'Manual override should stay authoritative',
      body: 'Classifier returns an existing manual tag and one new feature.',
      config: lowCostConfig,
      classify: async () => ({
        status: 'extracted',
        provider: 'stub',
        result: {
          data: {
            features: [
              { featureName: 'Manual Override', description: 'Classifier text', tags: ['classifier'] },
              { featureName: 'New Registry Feature', description: 'Classifier-owned', tags: ['registry'] },
            ],
          },
          usage: { input: 1, output: 1 },
          cost: { usd: 0 },
          model: 'stub-model',
          provider: 'stub',
        },
      }),
    }, {
      listEntries: async () => [manualEntry],
      showFeature: async (featureName) => featureName === 'Manual Override' ? manualEntry : null,
      tagIssue,
    });

    expect(tagIssue).toHaveBeenCalledOnce();
    expect(tagIssue).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-1204',
      featureName: 'New Registry Feature',
      description: 'Classifier-owned',
      tags: ['registry'],
      status: 'active',
    }));
  });

  it('updates registry ownership for workspace lifecycle transitions', async () => {
    const updateOwnership = vi.fn(async () => []);

    await updateFeatureRegistryForLifecycle({
      issueId: 'PAN-1204',
      workspacePath: '/repo/workspaces/feature-pan-1204',
      agentId: 'agent-pan-1204',
      status: 'active',
      now: '2026-05-24T12:00:00.000Z',
    }, { updateOwnership });

    expect(updateOwnership).toHaveBeenCalledWith({
      issueId: 'PAN-1204',
      workspaceId: 'feature-pan-1204',
      agentId: 'agent-pan-1204',
      status: 'active',
      now: '2026-05-24T12:00:00.000Z',
    });
  });
});
