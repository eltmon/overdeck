import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_METHODS } from '@overdeck/contracts';

const wsTransportMock = vi.hoisted(() => ({
  request: vi.fn(),
  getAvailableEditors: vi.fn(),
  shellOpenInEditor: vi.fn(),
  readWorkspaceFile: vi.fn(),
  getAvailableBrowsers: vi.fn(),
  shellOpenInBrowser: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('../../../lib/wsTransport', () => ({
  getTransport: () => wsTransportMock,
}));

vi.mock('sonner', () => ({
  toast: toastMock,
}));

vi.mock('@pierre/diffs', () => ({
  getSharedHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: (code: string) => `<pre><code>${code}</code></pre>`,
  }),
}));

// PAN-5295 WI-13: the panel's changes context; null (outside a scope) unless a test sets it.
const changesCtxMock = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../conversationChanges/ConversationChangesScope', () => ({
  useConversationChangesContext: () => changesCtxMock.value,
}));

import { MarkdownFileLink, fileLinkIconForPath } from '../MarkdownFileLink';
import { StageDeckProvider, type StageDeckContextValue } from '../../Stage/StageDeckContext';
import { CitationTargetContext } from '../../../lib/composerCitations';

const meta = {
  filePath: '/home/eltmon/project/src/App.tsx',
  targetPath: '/home/eltmon/project/src/App.tsx:12:5',
  displayPath: 'project/src/App.tsx:12:5',
  basename: 'App.tsx',
  line: 12,
  column: 5,
};

const markdownMeta = {
  filePath: '/home/eltmon/project/docs/README.md',
  targetPath: '/home/eltmon/project/docs/README.md',
  displayPath: 'project/docs/README.md',
  basename: 'README.md',
};

// PAN-4762 — a browser-renderable, non-markdown chip.
const htmlMeta = {
  filePath: '/home/eltmon/project/mockups/board.html',
  targetPath: '/home/eltmon/project/mockups/board.html:4',
  displayPath: 'project/mockups/board.html:4',
  basename: 'board.html',
  line: 4,
};

// PAN-4762 — a markdown chip whose extension is not browser-renderable.
const mdxMeta = {
  filePath: '/home/eltmon/project/docs/page.mdx',
  targetPath: '/home/eltmon/project/docs/page.mdx',
  displayPath: 'project/docs/page.mdx',
  basename: 'page.mdx',
};

// PAN-3260 — the reported case: a repo-root markdown chip inside a
// conversation with no workspace, so no issueId prop and no
// /workspaces/feature-<issue>/ path segment for issueIdFromPath to match.
const flywheelBriefMeta = {
  filePath: '/home/eltmon/Projects/overdeck/docs/flywheel-brief.md',
  targetPath: '/home/eltmon/Projects/overdeck/docs/flywheel-brief.md',
  displayPath: 'overdeck/docs/flywheel-brief.md',
  basename: 'flywheel-brief.md',
};

// PAN-3260 review fix — a markdown chip with line/column metadata: targetPath
// (used for external-editor goto syntax) carries a trailing `:12:5` that
// filePath (the real path) does not. The internal editor pane must read
// filePath, not targetPath, or extname() sees ".md:12:5" and rejects it.
const positionedMarkdownMeta = {
  filePath: '/home/eltmon/project/docs/README.md',
  targetPath: '/home/eltmon/project/docs/README.md:12:5',
  displayPath: 'project/docs/README.md:12:5',
  basename: 'README.md',
  line: 12,
  column: 5,
};

function renderWithDeck(
  ui: React.ReactElement,
  deck:
    | (Omit<StageDeckContextValue, 'openOrFocusAgentPane'> & Partial<Pick<StageDeckContextValue, 'openOrFocusAgentPane'>>)
    | null,
) {
  const value = deck ? { openOrFocusAgentPane: vi.fn(), ...deck } : null;
  return render(<StageDeckProvider value={value}>{ui}</StageDeckProvider>);
}

describe('MarkdownFileLink', () => {
  beforeEach(() => {
    localStorage.clear();
    toastMock.error.mockReset();
    toastMock.success.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    wsTransportMock.getAvailableEditors.mockReset();
    wsTransportMock.getAvailableEditors.mockResolvedValue({ editors: ['cursor', 'vscode'] });
    wsTransportMock.shellOpenInEditor.mockReset();
    wsTransportMock.shellOpenInEditor.mockResolvedValue({ success: true });
    wsTransportMock.readWorkspaceFile.mockReset();
    wsTransportMock.readWorkspaceFile.mockResolvedValue({
      text: 'export const value = 1;\n',
      lang: 'typescript',
      truncated: false,
      totalLines: 80,
    });
    wsTransportMock.getAvailableBrowsers.mockReset();
    wsTransportMock.getAvailableBrowsers.mockResolvedValue({ browsers: ['default-browser', 'chrome', 'firefox'] });
    wsTransportMock.shellOpenInBrowser.mockReset();
    wsTransportMock.shellOpenInBrowser.mockResolvedValue(undefined);
    wsTransportMock.request.mockReset();
    wsTransportMock.request.mockImplementation((connect: (client: Record<string, unknown>) => unknown) => connect({
      [WS_METHODS.getAvailableEditors]: wsTransportMock.getAvailableEditors,
      [WS_METHODS.shellOpenInEditor]: wsTransportMock.shellOpenInEditor,
      [WS_METHODS.readWorkspaceFile]: wsTransportMock.readWorkspaceFile,
      [WS_METHODS.getAvailableBrowsers]: wsTransportMock.getAvailableBrowsers,
      [WS_METHODS.shellOpenInBrowser]: wsTransportMock.shellOpenInBrowser,
    }));
  });

  it('renders a file chip with icon, display path, line suffix, and target tooltip', () => {
    render(<MarkdownFileLink {...meta} />);

    const link = screen.getByRole('link', { name: /project\/src\/App\.tsx · L12:C5/ });
    expect(link).toHaveAttribute('href', meta.targetPath);
    expect(link).toHaveAttribute('title', meta.targetPath);
    expect(link).toHaveClass('chat-markdown-file-link', 'font-mono', 'no-underline');
    expect(screen.getByTestId('markdown-file-link-icon')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-file-link-label')).toHaveTextContent('project/src/App.tsx · L12:C5');
  });

  it('opens targetPath with the stored preferred editor', async () => {
    localStorage.setItem('overdeck:last-editor', 'vscode');
    render(<MarkdownFileLink {...meta} />);

    fireEvent.click(screen.getByRole('link'));

    await waitFor(() => {
      expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({
        cwd: meta.targetPath,
        editor: 'vscode',
      });
    });
    expect(localStorage.getItem('overdeck:last-editor')).toBe('vscode');
  });

  it('falls back to the first available editor and persists it', async () => {
    wsTransportMock.getAvailableEditors.mockResolvedValue({ editors: ['vscode'] });
    render(<MarkdownFileLink {...meta} />);

    fireEvent.click(screen.getByRole('link'));

    await waitFor(() => {
      expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({
        cwd: meta.targetPath,
        editor: 'vscode',
      });
    });
    expect(localStorage.getItem('overdeck:last-editor')).toBe('vscode');
  });

  it('shows context menu actions in the expected order and prevents the native menu', () => {
    render(<MarkdownFileLink {...meta} />);
    const link = screen.getByRole('link');
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 24 });

    fireEvent(link, event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Open in editor',
      'Open containing folder',
      'Copy relative path',
      'Copy full path',
    ]);
  });

  it('copies the relative display path from the context menu', async () => {
    render(<MarkdownFileLink {...meta} />);

    fireEvent.contextMenu(screen.getByRole('link'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy relative path' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(meta.displayPath);
      expect(toastMock.success).toHaveBeenCalledWith('Copied relative path');
    });
  });

  it('copies the full target path from the context menu', async () => {
    render(<MarkdownFileLink {...meta} />);

    fireEvent.contextMenu(screen.getByRole('link'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy full path' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(meta.targetPath);
      expect(toastMock.success).toHaveBeenCalledWith('Copied full path');
    });
  });

  it('emits an error toast when clipboard writes fail', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<MarkdownFileLink {...meta} />);

    fireEvent.contextMenu(screen.getByRole('link'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy full path' }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith('Failed to copy full path: denied');
    });
  });

  it('opens the target path from the context menu and emits a success toast', async () => {
    localStorage.setItem('overdeck:last-editor', 'vscode');
    render(<MarkdownFileLink {...meta} />);

    fireEvent.contextMenu(screen.getByRole('link'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in editor' }));

    await waitFor(() => {
      expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({
        cwd: meta.targetPath,
        editor: 'vscode',
      });
      expect(toastMock.success).toHaveBeenCalledWith('Opened in editor');
    });
  });

  it('reveals the file path without the line suffix in the file manager', async () => {
    render(<MarkdownFileLink {...meta} />);

    fireEvent.contextMenu(screen.getByRole('link'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open containing folder' }));

    await waitFor(() => {
      expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({
        cwd: meta.filePath,
        editor: 'file-manager',
        reveal: true,
      });
    });
  });

  it('shows a Quickview popover on Shift+hover and requests a workspace-relative file preview', async () => {
    render(<MarkdownFileLink {...meta} issueId="PAN-1370" />);

    fireEvent.mouseEnter(screen.getByTestId('markdown-file-link-container'), { shiftKey: true });

    expect(await screen.findByTestId('markdown-file-quickview-content')).toHaveTextContent('export const value = 1;');
    expect(wsTransportMock.readWorkspaceFile).toHaveBeenCalledWith({
      issueId: 'PAN-1370',
      relativePath: 'src/App.tsx',
      line: 12,
      contextLines: 12,
    });
    expect(screen.getByText(/line 12 · 80 lines/)).toBeInTheDocument();
  });

  it('dismisses Quickview on mouse leave and Shift release', async () => {
    render(<MarkdownFileLink {...meta} issueId="PAN-1370" />);
    const container = screen.getByTestId('markdown-file-link-container');

    fireEvent.mouseEnter(container, { shiftKey: true });
    expect(await screen.findByTestId('markdown-file-quickview')).toBeInTheDocument();

    fireEvent.mouseLeave(container);
    expect(screen.queryByTestId('markdown-file-quickview')).not.toBeInTheDocument();

    fireEvent.mouseEnter(container, { shiftKey: true });
    expect(await screen.findByTestId('markdown-file-quickview')).toBeInTheDocument();
    fireEvent.keyUp(window, { key: 'Shift' });
    expect(screen.queryByTestId('markdown-file-quickview')).not.toBeInTheDocument();
  });

  it('positions Quickview inside the viewport near the right edge', async () => {
    render(<MarkdownFileLink {...meta} issueId="PAN-1370" />);
    const container = screen.getByTestId('markdown-file-link-container');
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      x: 760,
      y: 100,
      width: 32,
      height: 20,
      top: 100,
      right: 792,
      bottom: 120,
      left: 760,
      toJSON: () => ({}),
    });

    fireEvent.mouseEnter(container, { shiftKey: true });

    expect(await screen.findByTestId('markdown-file-quickview')).toHaveStyle({ right: '0px' });
  });

  it('shows a truncated indicator in the Quickview footer', async () => {
    wsTransportMock.readWorkspaceFile.mockResolvedValue({
      text: 'a'.repeat(10),
      lang: 'plaintext',
      truncated: true,
      totalLines: 1,
    });
    render(<MarkdownFileLink {...meta} issueId="PAN-1370" />);

    fireEvent.mouseEnter(screen.getByTestId('markdown-file-link-container'), { shiftKey: true });

    expect(await screen.findByTestId('markdown-file-quickview-truncated')).toHaveTextContent('truncated — first 256 KiB');
  });

  it('keeps plain left-click opening the file in the editor when Quickview is available', async () => {
    localStorage.setItem('overdeck:last-editor', 'vscode');
    render(<MarkdownFileLink {...meta} issueId="PAN-1370" />);

    fireEvent.click(screen.getByRole('link'));

    await waitFor(() => {
      expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({
        cwd: meta.targetPath,
        editor: 'vscode',
      });
    });
    expect(wsTransportMock.readWorkspaceFile).not.toHaveBeenCalled();
  });

  it('maps common file extensions to specialized icons and unknown files to a fallback', () => {
    expect(fileLinkIconForPath('/tmp/data.json').displayName ?? fileLinkIconForPath('/tmp/data.json').name).toBe('FileJson');
    expect(fileLinkIconForPath('/tmp/photo.png').displayName ?? fileLinkIconForPath('/tmp/photo.png').name).toBe('FileImage');
    expect(fileLinkIconForPath('/tmp/archive.zip').displayName ?? fileLinkIconForPath('/tmp/archive.zip').name).toBe('FileArchive');
    expect(fileLinkIconForPath('/tmp/unknown').displayName ?? fileLinkIconForPath('/tmp/unknown').name).toBe('File');
  });

  describe('markdown chip default-to-internal (PAN-3260)', () => {
    it('opens/focuses the internal editor pane by default and never calls shellOpenInEditor', () => {
      const openOrFocusEditorPane = vi.fn();
      renderWithDeck(<MarkdownFileLink {...markdownMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane });

      fireEvent.click(screen.getByRole('link'));

      expect(openOrFocusEditorPane).toHaveBeenCalledWith(markdownMeta.filePath, markdownMeta.basename, null);
      expect(wsTransportMock.shellOpenInEditor).not.toHaveBeenCalled();
    });

    it('opens the internal editor pane for a repo-root chip with no issueId and no workspace path segment (the flywheel-brief case)', () => {
      const openOrFocusEditorPane = vi.fn();
      renderWithDeck(<MarkdownFileLink {...flywheelBriefMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane });

      fireEvent.click(screen.getByRole('link'));

      expect(openOrFocusEditorPane).toHaveBeenCalledWith(flywheelBriefMeta.filePath, flywheelBriefMeta.basename, null);
      expect(wsTransportMock.shellOpenInEditor).not.toHaveBeenCalled();
    });

    it('opens the internal editor pane with the real file path, not the line-suffixed targetPath, for a positioned chip', () => {
      const openOrFocusEditorPane = vi.fn();
      renderWithDeck(<MarkdownFileLink {...positionedMarkdownMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane });

      fireEvent.click(screen.getByRole('link'));

      expect(openOrFocusEditorPane).toHaveBeenCalledWith(positionedMarkdownMeta.filePath, positionedMarkdownMeta.basename, null);
      expect(openOrFocusEditorPane).not.toHaveBeenCalledWith(positionedMarkdownMeta.targetPath, expect.anything(), null);
      expect(wsTransportMock.shellOpenInEditor).not.toHaveBeenCalled();
    });

    it('launches a persisted external editor target instead of opening a pane', async () => {
      localStorage.setItem('overdeck:markdown-open-target', 'vscode');
      const openOrFocusEditorPane = vi.fn();
      renderWithDeck(<MarkdownFileLink {...markdownMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane });

      fireEvent.click(screen.getByRole('link'));

      await waitFor(() => {
        expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({
          cwd: markdownMeta.targetPath,
          editor: 'vscode',
        });
      });
      expect(openOrFocusEditorPane).not.toHaveBeenCalled();
    });

    it('falls back to the external flow when the internal target has no deck context', async () => {
      localStorage.setItem('overdeck:last-editor', 'vscode');
      render(<MarkdownFileLink {...markdownMeta} />);

      fireEvent.click(screen.getByRole('link'));

      await waitFor(() => {
        expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({
          cwd: markdownMeta.targetPath,
          editor: 'vscode',
        });
      });
    });

    it('leaves non-markdown chips on the external flow even inside a deck', async () => {
      localStorage.setItem('overdeck:last-editor', 'vscode');
      const openOrFocusEditorPane = vi.fn();
      renderWithDeck(<MarkdownFileLink {...meta} />, { deckKey: 'overdeck', openOrFocusEditorPane });

      fireEvent.click(screen.getByRole('link'));

      await waitFor(() => {
        expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({
          cwd: meta.targetPath,
          editor: 'vscode',
        });
      });
      expect(openOrFocusEditorPane).not.toHaveBeenCalled();
    });
  });

  describe('markdown chip right-click menu (PAN-3260)', () => {
    // wsTransportMock.getAvailableEditors resolves ['cursor', 'vscode'] per
    // the outer beforeEach; MarkdownFileLink caches that fetch module-wide
    // (same pattern as the Quickview highlighter cache), so every test in
    // this block sees the same two external editors.
    it('lists the internal editor, then each available external editor, then browser items, then the copy actions, in that order', async () => {
      renderWithDeck(<MarkdownFileLink {...markdownMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane: vi.fn() });

      fireEvent.contextMenu(screen.getByRole('link'));

      await waitFor(() => {
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
          'Open in internal editor',
          'Open in Cursor',
          'Open in VS Code',
          'Open in browser',
          'Open in Google Chrome',
          'Open in Firefox',
          'Open containing folder',
          'Copy relative path',
          'Copy full path',
        ]);
      });

      // showContextMenu appends its menu directly to document.body, outside
      // React's tree, so RTL's automatic per-test cleanup does not remove it
      // — dismiss it explicitly or a later test's role queries can match
      // this leftover menu instead of its own.
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });

    it('choosing an external editor launches it and persists the choice for a later left click', async () => {
      const openOrFocusEditorPane = vi.fn();
      const { unmount } = renderWithDeck(<MarkdownFileLink {...markdownMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane });

      fireEvent.contextMenu(screen.getByRole('link'));
      const vscodeItem = await screen.findByRole('menuitem', { name: 'Open in VS Code' });
      fireEvent.click(vscodeItem);

      await waitFor(() => {
        expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({
          cwd: markdownMeta.targetPath,
          editor: 'vscode',
        });
      });
      expect(localStorage.getItem('overdeck:markdown-open-target')).toBe('vscode');

      // A later left click (even a fresh mount) reuses the persisted choice.
      unmount();
      wsTransportMock.shellOpenInEditor.mockClear();
      renderWithDeck(<MarkdownFileLink {...markdownMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane });
      fireEvent.click(screen.getByRole('link'));

      await waitFor(() => {
        expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({
          cwd: markdownMeta.targetPath,
          editor: 'vscode',
        });
      });
      expect(openOrFocusEditorPane).not.toHaveBeenCalled();
    });

    it('choosing "Open in internal editor" opens/focuses the pane and persists the internal target', async () => {
      localStorage.setItem('overdeck:markdown-open-target', 'vscode');
      const openOrFocusEditorPane = vi.fn();
      renderWithDeck(<MarkdownFileLink {...markdownMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane });

      fireEvent.contextMenu(screen.getByRole('link'));
      const internalItem = await screen.findByRole('menuitem', { name: 'Open in internal editor' });
      fireEvent.click(internalItem);

      expect(openOrFocusEditorPane).toHaveBeenCalledWith(markdownMeta.filePath, markdownMeta.basename, null);
      expect(localStorage.getItem('overdeck:markdown-open-target')).toBe('internal');
      expect(wsTransportMock.shellOpenInEditor).not.toHaveBeenCalled();
    });

    it('opens the internal editor pane with the real file path from the context menu for a positioned chip', async () => {
      const openOrFocusEditorPane = vi.fn();
      renderWithDeck(<MarkdownFileLink {...positionedMarkdownMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane });

      fireEvent.contextMenu(screen.getByRole('link'));
      const internalItem = await screen.findByRole('menuitem', { name: 'Open in internal editor' });
      fireEvent.click(internalItem);

      expect(openOrFocusEditorPane).toHaveBeenCalledWith(positionedMarkdownMeta.filePath, positionedMarkdownMeta.basename, null);
    });

    it('shows no browser items for an .mdx chip', async () => {
      renderWithDeck(<MarkdownFileLink {...mdxMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane: vi.fn() });

      fireEvent.contextMenu(screen.getByRole('link'));

      await waitFor(() => {
        const labels = screen.getAllByRole('menuitem').map((item) => item.textContent);
        expect(labels.some((label) => label?.startsWith('Open in browser'))).toBe(false);
        expect(labels.some((label) => label?.startsWith('Open in Google Chrome'))).toBe(false);
        expect(labels.some((label) => label?.startsWith('Open in Firefox'))).toBe(false);
      });
    });

    it('clicking Open in Google Chrome calls shellOpenInBrowser and leaves the markdown open target unchanged', async () => {
      renderWithDeck(<MarkdownFileLink {...markdownMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane: vi.fn() });

      fireEvent.contextMenu(screen.getByRole('link'));
      const chromeItem = await screen.findByRole('menuitem', { name: 'Open in Google Chrome' });
      fireEvent.click(chromeItem);

      await waitFor(() => {
        expect(wsTransportMock.shellOpenInBrowser).toHaveBeenCalledWith({
          path: markdownMeta.filePath,
          browser: 'chrome',
        });
      });
      expect(localStorage.getItem('overdeck:markdown-open-target')).toBeNull();
    });

    it('renders the original items plus the reveal action for a non-markdown chip', () => {
      render(<MarkdownFileLink {...meta} />);

      fireEvent.contextMenu(screen.getByRole('link'));

      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Open in editor',
        'Open containing folder',
        'Copy relative path',
        'Copy full path',
      ]);
    });
  });

  describe('browser items in the generic right-click menu (PAN-4762)', () => {
    it('lists browser items between Open in editor and Open containing folder for a browser-renderable chip', async () => {
      render(<MarkdownFileLink {...htmlMeta} />);

      fireEvent.contextMenu(screen.getByRole('link'));

      await waitFor(() => {
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
          'Open in editor',
          'Open in browser',
          'Open in Google Chrome',
          'Open in Firefox',
          'Open containing folder',
          'Copy relative path',
          'Copy full path',
        ]);
      });

      fireEvent.keyDown(document, { key: 'Escape' });
    });

    it('clicking Open in Firefox calls shellOpenInBrowser and shows a success toast', async () => {
      render(<MarkdownFileLink {...htmlMeta} />);

      fireEvent.contextMenu(screen.getByRole('link'));
      const firefoxItem = await screen.findByRole('menuitem', { name: 'Open in Firefox' });
      fireEvent.click(firefoxItem);

      await waitFor(() => {
        expect(wsTransportMock.shellOpenInBrowser).toHaveBeenCalledWith({
          path: htmlMeta.filePath,
          browser: 'firefox',
        });
        expect(toastMock.success).toHaveBeenCalledWith('Opened in Firefox');
      });
    });

    it('shows a failure toast when shellOpenInBrowser rejects', async () => {
      wsTransportMock.shellOpenInBrowser.mockRejectedValue(new Error('boom'));
      render(<MarkdownFileLink {...htmlMeta} />);

      fireEvent.contextMenu(screen.getByRole('link'));
      const browserItem = await screen.findByRole('menuitem', { name: 'Open in browser' });
      fireEvent.click(browserItem);

      await waitFor(() => {
        expect(toastMock.error).toHaveBeenCalledWith('Failed to open in browser: boom');
      });
    });

    it('does not request available browsers for a non-browser-renderable chip', async () => {
      render(<MarkdownFileLink {...meta} />);

      fireEvent.contextMenu(screen.getByRole('link'));

      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Open in editor',
        'Open containing folder',
        'Copy relative path',
        'Copy full path',
      ]);
      expect(wsTransportMock.getAvailableBrowsers).not.toHaveBeenCalled();
    });
  });

  describe('CitationTargetContext (PAN-4658)', () => {
    it('passes the provided conversation name as the third argument on click', () => {
      const openOrFocusEditorPane = vi.fn();
      renderWithDeck(
        <CitationTargetContext.Provider value="conv-a">
          <MarkdownFileLink {...markdownMeta} />
        </CitationTargetContext.Provider>,
        { deckKey: 'overdeck', openOrFocusEditorPane },
      );

      fireEvent.click(screen.getByRole('link'));

      expect(openOrFocusEditorPane).toHaveBeenCalledWith(markdownMeta.filePath, markdownMeta.basename, 'conv-a');
    });

    it('passes the provided conversation name from the right-click "Open in internal editor" item', async () => {
      const openOrFocusEditorPane = vi.fn();
      renderWithDeck(
        <CitationTargetContext.Provider value="conv-a">
          <MarkdownFileLink {...markdownMeta} />
        </CitationTargetContext.Provider>,
        { deckKey: 'overdeck', openOrFocusEditorPane },
      );

      fireEvent.contextMenu(screen.getByRole('link'));
      const internalItem = await screen.findByRole('menuitem', { name: 'Open in internal editor' });
      fireEvent.click(internalItem);

      expect(openOrFocusEditorPane).toHaveBeenCalledWith(markdownMeta.filePath, markdownMeta.basename, 'conv-a');
    });

    it('passes null as the third argument without a provider', () => {
      const openOrFocusEditorPane = vi.fn();
      renderWithDeck(<MarkdownFileLink {...markdownMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane });

      fireEvent.click(screen.getByRole('link'));

      expect(openOrFocusEditorPane).toHaveBeenCalledWith(markdownMeta.filePath, markdownMeta.basename, null);
    });
  });
});

describe('MarkdownFileLink inside a Stage with conversation changes (PAN-5295)', () => {
  const REPO = '/home/eltmon/project';
  const stage = {
    rootId: 'project:p',
    rootPathOf: (repoPath: string) => repoPath,
    repoPathOfAbs: (abs: string) => (abs.startsWith(`${REPO}/`) ? abs.slice(REPO.length + 1) : null),
    openDiff: vi.fn(),
    openBeside: vi.fn(),
    reveal: vi.fn(),
    showInFiles: vi.fn(),
  };
  const changes = {
    conversation: 'c1', repoRoot: REPO, rootId: null, branch: 'main', scope: 'conversation',
    uncommitted: [{ path: 'docs/README.md', status: 'M', additions: 2, deletions: 0, attribution: 'lines', turnIds: [] }],
    commits: [
      { sha: 'old1', shortSha: 'old1', subject: 's', authoredAt: '2026-11-01T00:00:00Z', pushed: true, attribution: 'trailer', files: [{ path: 'src/App.tsx', status: 'M', additions: 1, deletions: 0 }] },
      { sha: 'new2', shortSha: 'new2', subject: 's', authoredAt: '2026-11-02T00:00:00Z', pushed: false, attribution: 'trailer', files: [{ path: 'src/App.tsx', status: 'M', additions: 3, deletions: 1 }] },
    ],
    totals: { files: 2, additions: 6, deletions: 1, commitsPushed: 1, commitsLocal: 1, uncommittedFiles: 1 },
  };
  const readme = { path: 'docs/README.md', repoPath: 'docs/README.md', repoRoot: REPO };
  const appOld = { path: 'src/App.tsx', repoPath: 'src/App.tsx', repoRoot: REPO, sha: 'old1', pushed: true };
  const appNew = { path: 'src/App.tsx', repoPath: 'src/App.tsx', repoRoot: REPO, sha: 'new2', pushed: false };
  const unchangedTs = { filePath: `${REPO}/src/x.ts`, targetPath: `${REPO}/src/x.ts:12`, displayPath: 'project/src/x.ts:12', basename: 'x.ts', line: 12 };
  const unchangedMd = { filePath: `${REPO}/docs/guide.md`, targetPath: `${REPO}/docs/guide.md`, displayPath: 'project/docs/guide.md', basename: 'guide.md' };

  beforeEach(() => {
    localStorage.clear();
    for (const fn of [stage.openDiff, stage.openBeside, stage.reveal]) fn.mockReset();
    changesCtxMock.value = { conversation: { name: 'c1' }, changes, rootId: 'project:p', stage, openDiffWindow: vi.fn() };
    wsTransportMock.getAvailableEditors.mockReset();
    wsTransportMock.getAvailableEditors.mockResolvedValue({ editors: ['vscode'] });
    wsTransportMock.shellOpenInEditor.mockReset();
    wsTransportMock.shellOpenInEditor.mockResolvedValue({ success: true });
    wsTransportMock.getAvailableBrowsers.mockReset();
    wsTransportMock.getAvailableBrowsers.mockResolvedValue({ browsers: [] });
    wsTransportMock.request.mockReset();
    wsTransportMock.request.mockImplementation((connect: (client: Record<string, unknown>) => unknown) => connect({
      [WS_METHODS.getAvailableEditors]: wsTransportMock.getAvailableEditors,
      [WS_METHODS.shellOpenInEditor]: wsTransportMock.shellOpenInEditor,
      [WS_METHODS.getAvailableBrowsers]: wsTransportMock.getAvailableBrowsers,
    }));
  });

  afterEach(() => {
    changesCtxMock.value = null;
    fireEvent.keyDown(document, { key: 'Escape' });
  });

  const allTargets = [readme, appOld, appNew];

  it('opens the dock diff for an uncommitted path, with every conversation target as the list', () => {
    render(<MarkdownFileLink {...markdownMeta} />);
    fireEvent.click(screen.getByRole('link'));
    expect(stage.openDiff).toHaveBeenCalledWith(readme, allTargets);
    expect(wsTransportMock.shellOpenInEditor).not.toHaveBeenCalled();
  });

  it('opens the newest commit\'s diff for a committed path', () => {
    render(<MarkdownFileLink {...meta} />);
    fireEvent.click(screen.getByRole('link'));
    expect(stage.openDiff).toHaveBeenCalledWith(appNew, allTargets);
  });

  it('opens an unchanged .ts path beside the chat at its line', () => {
    render(<MarkdownFileLink {...unchangedTs} />);
    fireEvent.click(screen.getByRole('link'));
    expect(stage.openBeside).toHaveBeenCalledWith('src/x.ts', 12);
    expect(stage.openDiff).not.toHaveBeenCalled();
  });

  it('keeps the persisted Markdown open target for an unchanged .md path', async () => {
    // 'cursor' is not in the available list, so only the persisted-target path can choose it.
    localStorage.setItem('overdeck:markdown-open-target', 'cursor');
    render(<MarkdownFileLink {...unchangedMd} />);
    fireEvent.click(screen.getByRole('link'));
    await waitFor(() => expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({ cwd: unchangedMd.targetPath, editor: 'cursor' }));
    expect(stage.openBeside).not.toHaveBeenCalled();
  });

  it('keeps the external editor call for a path outside the repo', async () => {
    render(<MarkdownFileLink filePath="/elsewhere/y.ts" targetPath="/elsewhere/y.ts" displayPath="elsewhere/y.ts" basename="y.ts" />);
    fireEvent.click(screen.getByRole('link'));
    await waitFor(() => expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({ cwd: '/elsewhere/y.ts', editor: 'vscode' }));
    expect(stage.openBeside).not.toHaveBeenCalled();
  });

  it('changes nothing without the context', async () => {
    changesCtxMock.value = null;
    render(<MarkdownFileLink {...unchangedTs} />);
    fireEvent.click(screen.getByRole('link'));
    await waitFor(() => expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({ cwd: unchangedTs.targetPath, editor: 'vscode' }));
    expect(stage.openBeside).not.toHaveBeenCalled();
  });

  it('leads the context menu with Open diff, Open beside and Reveal in files', async () => {
    render(<MarkdownFileLink {...meta} />);
    fireEvent.contextMenu(screen.getByRole('link'));
    await waitFor(() => {
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent).slice(0, 4)).toEqual(['Open diff', 'Open beside', 'Reveal in files', 'Open in editor']);
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reveal in files' }));
    expect(stage.reveal).toHaveBeenCalledWith('src/App.tsx');
  });

  it('offers no Open diff for an unchanged path, and leads the Markdown menu too', async () => {
    render(<MarkdownFileLink {...unchangedMd} />);
    fireEvent.contextMenu(screen.getByRole('link'));
    await waitFor(() => {
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent).slice(0, 3)).toEqual(['Open beside', 'Reveal in files', 'Open in internal editor']);
    });
  });
});
