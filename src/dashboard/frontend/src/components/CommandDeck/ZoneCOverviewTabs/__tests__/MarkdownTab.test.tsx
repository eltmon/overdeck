/**
 * MarkdownTab document-location tests (PAN-5337, WI-4) and front matter
 * list tests (PAN-5427, WI-2).
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

const MISSION_CONTROL_BODY = [
  '---',
  'title: Mission Control',
  'description: Unified monitoring dashboard for projects, features, and AI agent activity',
  '---',
  '',
  '# Mission Control',
].join('\n');

describe('MarkdownTab front matter (PAN-5427)', () => {
  it('renders the front matter list above the heading, with docLocation', () => {
    rpc.listDir.mockResolvedValue(listing([]));
    renderTab(MISSION_CONTROL_BODY, { rootId: 'project:p', path: 'features/mission-control.mdx' });

    const list = screen.getByTestId('markdown-front-matter');
    expect(list).toHaveTextContent('title');
    expect(list).toHaveTextContent('Mission Control');
    expect(list).toHaveTextContent('description');
    expect(list).toHaveTextContent('Unified monitoring dashboard for projects, features, and AI agent activity');
    const dts = list.querySelectorAll('dt');
    expect(dts[0]).toHaveTextContent('title');
    expect(dts[1]).toHaveTextContent('description');

    const heading = screen.getByRole('heading', { name: 'Mission Control' });
    expect(list.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    for (const p of document.querySelectorAll('p')) {
      expect(p.textContent).not.toContain('title: Mission Control');
    }
    expect(document.querySelector('hr')).toBeNull();
  });

  it('renders the front matter list without docLocation', () => {
    renderTab(MISSION_CONTROL_BODY);

    expect(screen.getByTestId('markdown-front-matter')).toBeInTheDocument();
    for (const p of document.querySelectorAll('p')) {
      expect(p.textContent).not.toContain('title: Mission Control');
    }
    expect(document.querySelector('hr')).toBeNull();
  });

  it('still renders a mid-document "---" as an hr and skips the front matter list', () => {
    renderTab('# A\n\ntext\n\n---\n\nmore');

    expect(document.querySelector('hr')).not.toBeNull();
    expect(screen.queryByTestId('markdown-front-matter')).toBeNull();
  });

  it('renders no list for a fenced block with no key line, and still renders the hr', () => {
    renderTab('---\nSome prose\n---\n');

    expect(screen.queryByTestId('markdown-front-matter')).toBeNull();
    expect(document.querySelector('hr')).not.toBeNull();
  });

  it('renders the list with no empty-state label for a front-matter-only body', () => {
    renderTab('---\ntitle: X\n---\n');

    expect(screen.getByTestId('markdown-front-matter')).toBeInTheDocument();
    expect(screen.queryByTestId('markdown-tab-empty')).toBeNull();
  });
});
