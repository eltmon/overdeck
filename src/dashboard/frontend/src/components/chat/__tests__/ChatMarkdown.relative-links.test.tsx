import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerListDirResult } from '@overdeck/contracts';

// PAN-5337: a document-relative link in a Markdown preview must never reach
// the browser as a plain <a> — it would resolve against /conv/<id> and 404.
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/wsTransport', () => ({ getTransport: () => ({ request: vi.fn(), resolveFilePathExists: vi.fn() }) }));

const rpc = vi.hoisted(() => ({ listDir: vi.fn() }));
vi.mock('../../explorer/explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer/explorer-rpc')>()),
  listDir: rpc.listDir,
}));

import { ChatMarkdown } from '../ChatMarkdown';
import { clearDocLinkTargetCache } from '../docLinkTargets';
import { StageDeckProvider, type StageDeckContextValue } from '../../Stage/StageDeckContext';

function renderMarkdown(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

function listing(entries: ExplorerListDirResult['entries'], truncated = false): ExplorerListDirResult {
  return { entries, truncated, absPath: '/abs' };
}

function deckValue(over: Partial<StageDeckContextValue> = {}): StageDeckContextValue {
  return {
    deckKey: 'p',
    openOrFocusEditorPane: vi.fn(),
    openOrFocusAgentPane: vi.fn(),
    openBeside: vi.fn(),
    openDock: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  rpc.listDir.mockReset();
  clearDocLinkTargetCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatMarkdown relative links (PAN-5337)', () => {
  it('renders a relative link without cwd as inert text', () => {
    renderMarkdown(<ChatMarkdown text="[levels](levels/) [Fort](fort3d.md)" cwd={undefined} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('a')).toBeNull();
    expect(screen.getAllByTestId('markdown-inert-link')).toHaveLength(2);
    expect(screen.getByText('levels')).toBeInTheDocument();
    expect(screen.getByText('Fort')).toBeInTheDocument();
  });

  it('keeps /conv/123 as a TranscriptLink', () => {
    renderMarkdown(<ChatMarkdown text="[conv](/conv/123)" cwd={undefined} />);

    expect(screen.getByRole('link', { name: 'conv' })).toHaveAttribute('href', '/conv/123');
  });

  it('keeps https links with target _blank', () => {
    renderMarkdown(<ChatMarkdown text="[web](https://example.com)" cwd={undefined} />);

    expect(screen.getByRole('link', { name: 'web' })).toHaveAttribute('target', '_blank');
  });

  it('adds data-heading-slug to headings in a located preview', () => {
    renderMarkdown(<ChatMarkdown text="## Install" docLocation={{ rootId: 'project:p', path: 'docs/index.md' }} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('data-heading-slug', 'install');
  });

  it('adds no data-heading-slug in chat', () => {
    renderMarkdown(<ChatMarkdown text="## Install" />);

    expect(screen.getByRole('heading', { level: 2 })).not.toHaveAttribute('data-heading-slug');
    expect(document.querySelector('[data-heading-slug]')).toBeNull();
  });

  it('scrolls to the heading on a fragment click without changing location.hash', () => {
    const scrollIntoView = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrollIntoView);
    const hashBefore = window.location.hash;

    render(
      <div data-testid="markdown-tab">
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ChatMarkdown
            text={'## Install\n\n[go](#install)'}
            docLocation={{ rootId: 'project:p', path: 'docs/index.md' }}
          />
        </QueryClientProvider>
      </div>,
    );

    const heading = screen.getByRole('heading', { level: 2 });
    fireEvent.click(screen.getByRole('link', { name: 'go' }));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(scrollIntoView.mock.instances[0]).toBe(heading);
    expect(window.location.hash).toBe(hashBefore);
  });

  it('routes a relative link to MarkdownDocLink when docLocation is set', async () => {
    rpc.listDir.mockResolvedValue(
      listing([{ name: 'fort3d.md', path: 'docs/fort3d.md', kind: 'file', mtimeMs: 0, ignored: false }]),
    );
    const deck = deckValue();

    renderMarkdown(
      <StageDeckProvider value={deck}>
        <ChatMarkdown
          text="[Fort](fort3d.md) [At](fort3d.md:12)"
          docLocation={{ rootId: 'project:p', path: 'docs/index.md' }}
        />
      </StageDeckProvider>,
    );

    const link = await screen.findByRole('link', { name: 'Fort' });
    expect(link).toHaveAttribute('data-doc-link-state', 'file');
    expect(document.querySelector('a[href="fort3d.md"]')).toBeNull();

    fireEvent.click(link);
    expect(deck.openBeside).toHaveBeenCalledWith({ rootId: 'project:p', path: 'docs/fort3d.md', preview: true });

    // The :12 suffix survives react-markdown's urlTransform hop into the real href.
    const linkWithLine = screen.getByRole('link', { name: 'At' });
    fireEvent.click(linkWithLine);
    expect(deck.openBeside).toHaveBeenCalledWith({ rootId: 'project:p', path: 'docs/fort3d.md', line: 12, preview: true });
  });
});
