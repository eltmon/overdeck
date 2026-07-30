import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_METHODS } from '@overdeck/contracts';

const wsTransportMock = vi.hoisted(() => ({
  request: vi.fn(),
  getAvailableEditors: vi.fn(),
  shellOpenInEditor: vi.fn(),
  readWorkspaceFile: vi.fn(),
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

import { MarkdownFileLink, fileLinkIconForPath } from '../MarkdownFileLink';
import { StageDeckProvider, type StageDeckContextValue } from '../../Stage/StageDeckContext';

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

function renderWithDeck(ui: React.ReactElement, deck: StageDeckContextValue | null) {
  return render(<StageDeckProvider value={deck}>{ui}</StageDeckProvider>);
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
    wsTransportMock.request.mockReset();
    wsTransportMock.request.mockImplementation((connect: (client: Record<string, unknown>) => unknown) => connect({
      [WS_METHODS.getAvailableEditors]: wsTransportMock.getAvailableEditors,
      [WS_METHODS.shellOpenInEditor]: wsTransportMock.shellOpenInEditor,
      [WS_METHODS.readWorkspaceFile]: wsTransportMock.readWorkspaceFile,
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

      expect(openOrFocusEditorPane).toHaveBeenCalledWith(markdownMeta.filePath, markdownMeta.basename);
      expect(wsTransportMock.shellOpenInEditor).not.toHaveBeenCalled();
    });

    it('opens the internal editor pane for a repo-root chip with no issueId and no workspace path segment (the flywheel-brief case)', () => {
      const openOrFocusEditorPane = vi.fn();
      renderWithDeck(<MarkdownFileLink {...flywheelBriefMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane });

      fireEvent.click(screen.getByRole('link'));

      expect(openOrFocusEditorPane).toHaveBeenCalledWith(flywheelBriefMeta.filePath, flywheelBriefMeta.basename);
      expect(wsTransportMock.shellOpenInEditor).not.toHaveBeenCalled();
    });

    it('opens the internal editor pane with the real file path, not the line-suffixed targetPath, for a positioned chip', () => {
      const openOrFocusEditorPane = vi.fn();
      renderWithDeck(<MarkdownFileLink {...positionedMarkdownMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane });

      fireEvent.click(screen.getByRole('link'));

      expect(openOrFocusEditorPane).toHaveBeenCalledWith(positionedMarkdownMeta.filePath, positionedMarkdownMeta.basename);
      expect(openOrFocusEditorPane).not.toHaveBeenCalledWith(positionedMarkdownMeta.targetPath, expect.anything());
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
    it('lists the internal editor, then each available external editor, then the copy actions, in that order', async () => {
      renderWithDeck(<MarkdownFileLink {...markdownMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane: vi.fn() });

      fireEvent.contextMenu(screen.getByRole('link'));

      await waitFor(() => {
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
          'Open in internal editor',
          'Open in Cursor',
          'Open in VS Code',
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

      expect(openOrFocusEditorPane).toHaveBeenCalledWith(markdownMeta.filePath, markdownMeta.basename);
      expect(localStorage.getItem('overdeck:markdown-open-target')).toBe('internal');
      expect(wsTransportMock.shellOpenInEditor).not.toHaveBeenCalled();
    });

    it('opens the internal editor pane with the real file path from the context menu for a positioned chip', async () => {
      const openOrFocusEditorPane = vi.fn();
      renderWithDeck(<MarkdownFileLink {...positionedMarkdownMeta} />, { deckKey: 'overdeck', openOrFocusEditorPane });

      fireEvent.contextMenu(screen.getByRole('link'));
      const internalItem = await screen.findByRole('menuitem', { name: 'Open in internal editor' });
      fireEvent.click(internalItem);

      expect(openOrFocusEditorPane).toHaveBeenCalledWith(positionedMarkdownMeta.filePath, positionedMarkdownMeta.basename);
    });

    it('renders exactly the three original items for a non-markdown chip', () => {
      render(<MarkdownFileLink {...meta} />);

      fireEvent.contextMenu(screen.getByRole('link'));

      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Open in editor',
        'Copy relative path',
        'Copy full path',
      ]);
    });
  });
});
