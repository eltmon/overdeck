import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrdViewer } from './PrdViewer';

vi.mock('./chat/ChatMarkdown', () => ({
  ChatMarkdown: ({ text, issueId }: { text: string; issueId: string }) => (
    <article data-testid="chat-markdown" data-issue-id={issueId}>{text}</article>
  ),
}));

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PrdViewer', () => {
  it('fetches the canonical PRD and renders it through ChatMarkdown', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      hasPrd: true,
      content: '# Artifact viewers\n\n- PRD chip',
      path: '/state/overdeck/drafts/pan-3231.md',
      status: 'draft',
      format: 'pan-draft',
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<PrdViewer issueId="PAN-3231" onClose={vi.fn()} />, { wrapper });

    const dialog = screen.getByRole('dialog', { name: 'PRD: PAN-3231' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    const markdown = await screen.findByTestId('chat-markdown');
    expect(markdown).toHaveTextContent('# Artifact viewers');
    expect(markdown).toHaveAttribute('data-issue-id', 'PAN-3231');
    expect(screen.getByText('/state/overdeck/drafts/pan-3231.md')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/issues/PAN-3231/prd');
  });

  it('renders the empty state when the issue has no PRD draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));

    render(<PrdViewer issueId="PAN-3231" onClose={vi.fn()} />, { wrapper });

    expect(await screen.findByText('No PRD draft for this issue.')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-markdown')).not.toBeInTheDocument();
  });

  it('closes on Escape, the close button, and the scrim', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const onClose = vi.fn();
    const { container } = render(<PrdViewer issueId="PAN-3231" onClose={onClose} />, { wrapper });

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close PRD viewer' }));
    fireEvent.click(container.querySelector('.absolute.inset-0')!);

    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
