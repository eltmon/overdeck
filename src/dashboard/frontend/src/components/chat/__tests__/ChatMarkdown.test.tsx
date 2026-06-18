import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cloneElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_METHODS } from '@overdeck/contracts';

// PAN-1457: MarkdownFileLink chips now require a server-side existence check.
// Tests must mock the resolveFilePathExists RPC and wait for it to resolve.
const wsTransportMock = vi.hoisted(() => ({
  request: vi.fn(),
  resolveFilePathExists: vi.fn(),
}));

vi.mock('../../../lib/wsTransport', () => ({
  getTransport: () => wsTransportMock,
}));

import { ChatMarkdown } from '../ChatMarkdown';
import { _resetFilePathExistsCacheForTests } from '../../../lib/filePathExistsCache';

function mockExists(exists: boolean, kind: 'file' | 'dir' | null = 'file') {
  wsTransportMock.resolveFilePathExists.mockResolvedValue({ exists, kind });
  wsTransportMock.request.mockImplementation((connect: (client: Record<string, unknown>) => unknown) =>
    connect({
      [WS_METHODS.resolveFilePathExists]: wsTransportMock.resolveFilePathExists,
    }),
  );
}

function renderMarkdown(node: ReactElement, streamdownRenderer = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const withRenderer = (child: ReactElement) =>
    cloneElement(child as ReactElement<{ useStreamdown?: boolean }>, { useStreamdown: streamdownRenderer });
  const wrap = (child: ReactElement) => (
    <QueryClientProvider client={queryClient}>{withRenderer(child)}</QueryClientProvider>
  );
  const result = render(wrap(node));
  return {
    ...result,
    rerender: (next: ReactElement) => result.rerender(wrap(next)),
  };
}

describe('ChatMarkdown file links', () => {
  beforeEach(() => {
    _resetFilePathExistsCacheForTests();
    wsTransportMock.request.mockReset();
    wsTransportMock.resolveFilePathExists.mockReset();
  });

  it('renders bare assistant file paths as MarkdownFileLink chips once existence is confirmed', async () => {
    mockExists(true, 'file');
    renderMarkdown(<ChatMarkdown text="Open package.json:1 or /home/eltmon/project/src/App.tsx:42:5." cwd="/home/eltmon/project" />);

    expect(await screen.findByRole('link', { name: /project\/package\.json · L1/ })).toHaveClass('chat-markdown-file-link');
    expect(await screen.findByRole('link', { name: /project\/src\/App\.tsx · L42:C5/ })).toHaveClass('chat-markdown-file-link');
  });

  it('keeps bare assistant file paths as text when cwd is unavailable', () => {
    renderMarkdown(<ChatMarkdown text="Open /home/eltmon/project/src/App.tsx:42:5." cwd={undefined} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Open /home/eltmon/project/src/App.tsx:42:5.')).toBeInTheDocument();
  });

  it('renders file hrefs as MarkdownFileLink chips once existence is confirmed', async () => {
    mockExists(true, 'file');
    renderMarkdown(<ChatMarkdown text="Open [package.json:1](package.json:1)." cwd="/home/eltmon/project" />);

    const link = await screen.findByRole('link', { name: /project\/package\.json · L1/ });
    expect(link).toHaveClass('chat-markdown-file-link');
    expect(link).toHaveAttribute('href', '/home/eltmon/project/package.json:1');
  });

  it('preserves file-link chips through the Streamdown renderer path', async () => {
    mockExists(true, 'file');
    renderMarkdown(<ChatMarkdown text="Open [package.json:1](package.json:1)." cwd="/home/eltmon/project" />, true);

    const link = await screen.findByRole('link', { name: /project\/package\.json · L1/ });
    expect(link).toHaveClass('chat-markdown-file-link');
    expect(link).toHaveAttribute('href', '/home/eltmon/project/package.json:1');
  });

  it('keeps phantom paths like conv/2209 as plain text when existence check returns false', async () => {
    mockExists(false, null);
    renderMarkdown(<ChatMarkdown text="See conv/2209 for context." cwd="/home/eltmon/project" />);

    // Wait for the existence check to resolve, then confirm no chip rendered.
    await waitFor(() => expect(wsTransportMock.resolveFilePathExists).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /conv\/2209/ })).not.toBeInTheDocument();
    expect(screen.getByText(/conv\/2209/)).toBeInTheDocument();
  });

  it('keeps file-like hrefs as normal markdown links when cwd is unavailable', () => {
    renderMarkdown(<ChatMarkdown text="Open [package.json:1](package.json:1)." cwd={undefined} />);

    const link = screen.getByRole('link', { name: 'package.json:1' });
    expect(link).not.toHaveClass('chat-markdown-file-link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('keeps external links safe and blocks scriptable hrefs', () => {
    const { rerender } = renderMarkdown(<ChatMarkdown text="Visit [site](https://example.com)." cwd="/tmp/project" />);

    const external = screen.getByRole('link', { name: 'site' });
    expect(external).toHaveAttribute('href', 'https://example.com');
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');

    rerender(<ChatMarkdown text="Bad [link](javascript:alert(1))." cwd="/tmp/project" />);
    expect(screen.getByText('link').closest('a')).not.toHaveAttribute('href');
  });

  it('keeps Streamdown-rendered external links safe and blocks scriptable hrefs', async () => {
    const { rerender } = renderMarkdown(<ChatMarkdown text="Visit [site](https://example.com)." cwd="/tmp/project" />, true);

    const external = await screen.findByRole('link', { name: 'site' });
    await waitFor(() => expect(external).toHaveAttribute('href', 'https://example.com/'));
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');

    rerender(<ChatMarkdown text="Bad [link](javascript:alert(1))." cwd="/tmp/project" />);
    await waitFor(() => expect(screen.getByText(/link \[blocked\]/).closest('a')).toBeNull());
  });
});
