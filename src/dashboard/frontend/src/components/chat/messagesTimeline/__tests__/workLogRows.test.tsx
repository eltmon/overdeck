import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkLogEntry } from '../../chat-types';
import { clearToolBodyCacheForTests, ToolBodyLoaderContext, toolBodyLoaderFor } from '../toolBodyLoader';
import { WorkLogGroup } from '../workLogRows';

vi.mock('../../ChatMarkdown', () => ({
  ChatMarkdown: ({ text }: { text: string }) => <div data-testid="chat-markdown">{text}</div>,
}));

const omitted: WorkLogEntry = {
  id: 'toolu_big',
  createdAt: '2026-10-19T00:00:00.000Z',
  label: 'Read',
  tone: 'tool',
  toolTitle: 'Read',
  resultBytes: 10_240,
  bodyOmitted: true,
};

function renderWithLoader(children: ReactNode) {
  const loader = toolBodyLoaderFor('/api/conversations/conv-1/tool-body');
  return render(<ToolBodyLoaderContext.Provider value={loader}>{children}</ToolBodyLoaderContext.Provider>);
}

afterEach(() => {
  clearToolBodyCacheForTests();
  vi.unstubAllGlobals();
});

describe('tool rows with an omitted body (PAN-4558)', () => {
  it('shows the size hint and counts the row as having a result', () => {
    renderWithLoader(<WorkLogGroup entries={[omitted]} />);
    expect(screen.getByText('10.0 KB')).toBeInTheDocument();
  });

  it('fetches the full entry once on expand and renders its result', async () => {
    const fetchMock = vi.fn(async () => Response.json({ entry: { ...omitted, bodyOmitted: undefined, resultBytes: undefined, result: 'FULL RESULT TEXT' } }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithLoader(<WorkLogGroup entries={[omitted]} />);

    fireEvent.click(screen.getByText('Read'));
    expect(screen.getByText('Loading full output…')).toBeInTheDocument();
    expect(await screen.findByText('FULL RESULT TEXT')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/conversations/conv-1/tool-body/toolu_big');

    // Collapse and expand again: served from the cache.
    fireEvent.click(screen.getByText('Read'));
    fireEvent.click(screen.getByText('Read'));
    expect(await screen.findByText('FULL RESULT TEXT')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says so when the full output cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Tool entry not found' }, { status: 404 })));
    renderWithLoader(<WorkLogGroup entries={[omitted]} />);
    fireEvent.click(screen.getByText('Read'));
    await waitFor(() => expect(screen.getByText('Could not load the full output.')).toBeInTheDocument());
  });

  it('does not fetch for a row that carries its result inline', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithLoader(<WorkLogGroup entries={[{ ...omitted, bodyOmitted: undefined, resultBytes: undefined, result: 'inline' }]} />);
    fireEvent.click(screen.getByText('Read'));
    expect(screen.getByText('inline')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
