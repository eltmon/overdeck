// PAN-5338 WI-5: the Diff/Preview switch and Open file, wired into DiffPanel.
// DiffPanel now pulls in ChatMarkdown (via DiffMarkdownPreview → MarkdownTab),
// so this reuses the real useTheme/useColorTheme stores, same as
// DiffPanel.compare.test.tsx — a plain useTheme stub is not enough once that
// chain's useColorTheme module reads useTheme.getState()/subscribe().

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

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
      ignoreWhitespace: false,
    },
    update: vi.fn(),
  }),
}));

// The shadow-DOM renderer is out of scope here.
vi.mock('@pierre/diffs/react', () => ({
  Virtualizer: ({ children }: { children: ReactNode }) => <div data-testid="virtualizer">{children}</div>,
  FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => <div data-testid="file-diff">{fileDiff.name}</div>,
}));

const readFileMock = vi.hoisted(() => vi.fn());
vi.mock('../explorer/explorer-rpc', async () => {
  const actual = await vi.importActual<typeof import('../explorer/explorer-rpc')>('../explorer/explorer-rpc');
  return { ...actual, readFile: readFileMock };
});

import { DiffPanel } from '../DiffPanel';
import { StageDeckProvider, type StageDeckContextValue } from '../Stage/StageDeckContext';

const ADDED_MARKDOWN_PATCH = [
  'diff --git a/docs/a.md b/docs/a.md',
  'new file mode 100644',
  'index 0000000..1111111',
  '--- /dev/null',
  '+++ b/docs/a.md',
  '@@ -0,0 +1,1 @@',
  '+# Title',
  '',
].join('\n');

const MODIFIED_TS_PATCH = [
  'diff --git a/x.ts b/x.ts',
  'index 1111111..2222222 100644',
  '--- a/x.ts',
  '+++ b/x.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  '',
].join('\n');

const DELETED_MARKDOWN_PATCH = [
  'diff --git a/docs/c.md b/docs/c.md',
  'deleted file mode 100644',
  'index 1111111..0000000',
  '--- a/docs/c.md',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-gone',
  '',
].join('\n');

const MODIFIED_MARKDOWN_PATCH = [
  'diff --git a/docs/b.md b/docs/b.md',
  'index 1111111..2222222 100644',
  '--- a/docs/b.md',
  '+++ b/docs/b.md',
  '@@ -1 +1 @@',
  '-old body',
  '+new body',
  '',
].join('\n');

const LIST_FILES = [
  { path: 'docs/a.md', kind: 'A' },
  { path: 'x.ts', kind: 'M' },
  { path: 'docs/c.md', kind: 'D' },
  { path: 'docs/b.md', kind: 'M' },
];

const DIFFS_BY_FILE: Record<string, string> = {
  'docs/a.md': ADDED_MARKDOWN_PATCH,
  'x.ts': MODIFIED_TS_PATCH,
  'docs/c.md': DELETED_MARKDOWN_PATCH,
  'docs/b.md': MODIFIED_MARKDOWN_PATCH,
};

function mockVsMainFetch() {
  globalThis.fetch = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const file = url.searchParams.get('file');
    const body = file ? { diff: DIFFS_BY_FILE[file] ?? '' } : { files: LIST_FILES };
    return { ok: true, json: async () => body } as Response;
  });
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof DiffPanel>> = {},
  deck: Partial<StageDeckContextValue> | null = { openBeside: vi.fn(() => 'code-1') },
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const deckValue: StageDeckContextValue | null = deck
    ? {
        deckKey: 'proj',
        openOrFocusEditorPane: vi.fn(),
        openOrFocusAgentPane: vi.fn(),
        ...deck,
      }
    : null;
  return render(
    <QueryClientProvider client={queryClient}>
      <StageDeckProvider value={deckValue}>
        <DiffPanel
          mode="inline"
          agentId="agent-1"
          turnDiffSummaries={[]}
          diffUrlPrefix="/api/conversations/c1/diffs"
          isolateSelection
          defaultView="vs-main"
          explorerRootId="issue:PAN-1"
          {...props}
        />
      </StageDeckProvider>
    </QueryClientProvider>,
  );
}

async function selectFile(name: string) {
  const entry = await screen.findByText(name);
  fireEvent.click(entry);
  await screen.findByTestId('diff-file-bar');
}

describe('DiffPanel Markdown preview and Open file (PAN-5338)', () => {
  beforeEach(() => {
    readFileMock.mockReset();
    mockVsMainFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the Preview tab for an added Markdown file and renders its rendered text', async () => {
    renderPanel();
    await selectFile('a.md');

    expect(await screen.findByRole('tab', { name: 'Diff' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('tab', { name: 'Preview' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    expect(document.querySelector('[data-diff-file-path]')).toBeNull();
  });

  it('shows no tablist for a non-Markdown file', async () => {
    renderPanel();
    await selectFile('x.ts');

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('shows no tablist for a deleted Markdown file', async () => {
    renderPanel();
    await selectFile('c.md');

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('calls openBeside with the root id and the file path when Open file is clicked', async () => {
    const openBeside = vi.fn(() => 'code-1');
    renderPanel({}, { openBeside });
    await selectFile('a.md');

    fireEvent.click(screen.getByRole('button', { name: 'Open file' }));
    expect(openBeside).toHaveBeenCalledWith({ rootId: 'issue:PAN-1', path: 'docs/a.md' });
  });

  it('renders no Open file button without a StageDeckProvider deck', async () => {
    renderPanel({}, null);
    await selectFile('a.md');

    expect(screen.queryByRole('button', { name: 'Open file' })).not.toBeInTheDocument();
  });

  it('returns to the diff when a different file is selected after Preview', async () => {
    renderPanel();
    await selectFile('a.md');
    fireEvent.click(await screen.findByRole('tab', { name: 'Preview' }));
    await screen.findByTestId('diff-markdown-preview');

    // Back to the file list, then pick another file.
    fireEvent.click(screen.getByText('vs main'));
    await selectFile('b.md');

    expect(screen.queryByTestId('diff-markdown-preview')).not.toBeInTheDocument();
  });

  it('carries the explorer root into the pop-out URL', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPanel();

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Open diff in new window'));

    const popoutUrl = new URL(String(open.mock.calls[0]?.[0]), 'http://localhost');
    expect(popoutUrl.searchParams.get('root')).toBe('issue:PAN-1');
  });
});
