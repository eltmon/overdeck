/**
 * MarkdownTab document-location tests (PAN-5337, WI-4).
 */

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerListDirResult } from '@overdeck/contracts';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({ getTransport: () => ({ request: vi.fn(), resolveFilePathExists: vi.fn() }) }));

const rpc = vi.hoisted(() => ({ listDir: vi.fn() }));
vi.mock('../../../explorer/explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../explorer/explorer-rpc')>()),
  listDir: rpc.listDir,
}));

import { MarkdownTab } from '../MarkdownTab';
import { clearDocLinkTargetCache } from '../../../chat/docLinkTargets';
import { StageDeckProvider, type StageDeckContextValue } from '../../../Stage/StageDeckContext';

function deckValue(): StageDeckContextValue {
  return {
    deckKey: 'p',
    openOrFocusEditorPane: vi.fn(),
    openOrFocusAgentPane: vi.fn(),
    openBeside: vi.fn(),
    openDock: vi.fn(),
  };
}

function renderTab(body: string, docLocation?: { rootId: string; path: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StageDeckProvider value={deckValue()}>
        <MarkdownTab body={body} docLocation={docLocation} />
      </StageDeckProvider>
    </QueryClientProvider>,
  );
}

function listing(entries: ExplorerListDirResult['entries']): ExplorerListDirResult {
  return { entries, truncated: false, absPath: '/abs' };
}

beforeEach(() => {
  rpc.listDir.mockReset();
  clearDocLinkTargetCache();
});

describe('MarkdownTab document location (PAN-5337)', () => {
  it('renders relative links inert without a document location', () => {
    renderTab('[Fort](fort3d.md)');

    expect(screen.getByTestId('markdown-inert-link')).toBeInTheDocument();
    expect(document.querySelector('a')).toBeNull();
  });

  it('passes the document location so a relative link resolves', async () => {
    rpc.listDir.mockResolvedValue(
      listing([{ name: 'fort3d.md', path: 'docs/fort3d.md', kind: 'file', mtimeMs: 0, ignored: false }]),
    );

    renderTab('[Fort](fort3d.md)', { rootId: 'project:p', path: 'docs/index.md' });

    const link = await screen.findByRole('link', { name: 'Fort' });
    expect(link).toHaveAttribute('data-doc-link-state', 'file');
  });
});
