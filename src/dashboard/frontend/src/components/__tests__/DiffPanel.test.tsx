/**
 * PAN-4501: a conversation with zero completed turns (no edit turns yet, or a
 * whole-conversation / vs-main view) must still show its file list from
 * /diffs/full or /diffs/vs-main, never the "No completed turns yet." message
 * that used to gate on turnDiffSummaries being empty.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}));

vi.mock('../../hooks/useDiffPreferences', () => ({
  useDiffPreferences: () => ({
    prefs: {
      diffRenderMode: 'stacked',
      diffWordWrap: false,
      lineDiffType: 'word-alt',
      diffIndicators: 'bars',
      hunkSeparators: 'line-info',
      expandUnchanged: false,
      collapsedContextThreshold: 1,
      lineHoverHighlight: 'disabled',
      disableLineNumbers: false,
      enableLineSelection: false,
    },
    update: vi.fn(),
  }),
}));

import { DiffPanel } from '../DiffPanel';

function renderPanel(props: Partial<React.ComponentProps<typeof DiffPanel>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DiffPanel
        mode="inline"
        agentId="agent-1"
        turnDiffSummaries={[]}
        diffUrlPrefix="/api/conversations/c1/diffs"
        isolateSelection
        {...props}
      />
    </QueryClientProvider>,
  );
}

function mockFetchFiles(files: Array<{ path: string; additions?: number; deletions?: number }>) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({ files, diff: '' }),
  } as Response);
}

describe('DiffPanel zero-turn file lists (PAN-4501)', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('fetches /full and renders files when there are zero turn summaries', async () => {
    mockFetchFiles([{ path: 'x.ts', additions: 1, deletions: 0 }]);

    renderPanel();

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/conversations/c1/diffs/full'));
    expect(await screen.findByText('x.ts')).toBeInTheDocument();
    expect(screen.queryByText('No completed turns yet.')).not.toBeInTheDocument();
  });

  it('fetches /vs-main and renders files when defaultView is vs-main', async () => {
    mockFetchFiles([{ path: 'x.ts', additions: 1, deletions: 0 }]);

    renderPanel({ defaultView: 'vs-main' });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/conversations/c1/diffs/vs-main'));
    expect(await screen.findByText('x.ts')).toBeInTheDocument();
  });

  it('fetches the file-scoped vs-main URL after clicking a file', async () => {
    mockFetchFiles([{ path: 'x.ts', additions: 1, deletions: 0 }]);

    renderPanel({ defaultView: 'vs-main' });

    const fileEntry = await screen.findByText('x.ts');
    fireEvent.click(fileEntry);

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/conversations/c1/diffs/vs-main?file=x.ts'),
    );
  });

  it('never renders "No completed turns yet." with zero turn summaries', async () => {
    mockFetchFiles([]);

    renderPanel();

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByText('No completed turns yet.')).not.toBeInTheDocument();
  });
});
