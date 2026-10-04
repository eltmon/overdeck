import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DiffPanel } from '../DiffPanel';

function renderPanel(repoPath?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DiffPanel
        mode="inline"
        agentId="conv-1"
        turnDiffSummaries={[]}
        diffUrlPrefix="/api/conversations/conv-1/diffs"
        repoPath={repoPath}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/conv/1');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/diffs/refs')) {
      return new Response(JSON.stringify({ branches: [], tags: [], commits: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ files: [] }), { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DiffPanel Compare view (PAN-4503)', () => {
  it('hides the Compare chip without a repoPath', () => {
    renderPanel();
    expect(screen.queryByText('Compare…')).toBeNull();
  });

  it('writes the applied compare to the URL and carries repo into the pop-out URL', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPanel('/repo/path');

    fireEvent.click(screen.getByText('Compare…'));
    expect(screen.getByText('Pick a base and head to compare.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Compare base ref'), { target: { value: 'v1' } });
    fireEvent.change(screen.getByLabelText('Compare head ref'), { target: { value: 'main' } });
    fireEvent.click(screen.getByLabelText('Three-dot compare'));
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

    const search = new URLSearchParams(window.location.search);
    expect(search.get('diffTurnId')).toBe('compare');
    expect(search.get('diffBase')).toBe('v1');
    expect(search.get('diffHead')).toBe('main');
    expect(search.get('diffMode')).toBe('three-dot');

    fireEvent.click(screen.getByLabelText('Open diff in new window'));
    const popoutUrl = new URL(String(open.mock.calls[0]?.[0]), 'http://localhost');
    expect(popoutUrl.pathname).toBe('/popout/diff');
    expect(popoutUrl.searchParams.get('repo')).toBe('/repo/path');
    expect(popoutUrl.searchParams.get('diffTurnId')).toBe('compare');
    expect(popoutUrl.searchParams.get('diffBase')).toBe('v1');
    expect(popoutUrl.searchParams.get('diffHead')).toBe('main');
    expect(popoutUrl.searchParams.get('diffMode')).toBe('three-dot');
  });
});
