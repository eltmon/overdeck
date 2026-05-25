import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureRegistryEntry } from '@panctl/contracts';

import { HomePage } from './HomePage';

function makeEntry(overrides: Partial<FeatureRegistryEntry> = {}): FeatureRegistryEntry {
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
    tags: ['briefing', 'memory'],
    ...overrides,
  };
}

function renderHomePage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <HomePage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('HomePage', () => {
  it('renders Knowledge Registry rows from the dashboard API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [makeEntry()] })));

    renderHomePage();

    expect(await screen.findByText('context-distribution')).toBeInTheDocument();
    expect(screen.getByText('PAN-1204')).toBeInTheDocument();
    expect(screen.getByText('feature-pan-1204')).toBeInTheDocument();
    expect(screen.getByText('agent-pan-1204')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('briefing, memory')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/registry/features');
  });

  it('points users to registry tagging when no features are registered', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [] })));

    renderHomePage();

    expect(await screen.findByText('No features are registered yet.')).toBeInTheDocument();
    expect(screen.getByText('pan registry tag <issueId> <feature>')).toBeInTheDocument();
    expect(screen.getByText(/Automatic classification will populate future entries/)).toBeInTheDocument();
  });

  it('localizes registry loading errors to the registry card', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));

    renderHomePage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Knowledge Registry could not be loaded. The rest of Home is still available.');
    expect(screen.getByText('System briefing')).toBeInTheDocument();
  });
});
