import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_METHODS } from '@panctl/contracts';

const wsTransportMock = vi.hoisted(() => ({
  request: vi.fn(),
  getAvailableEditors: vi.fn(),
  shellOpenInEditor: vi.fn(),
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

import { MarkdownFileLink, fileLinkIconForPath } from '../MarkdownFileLink';

const meta = {
  filePath: '/home/eltmon/project/src/App.tsx',
  targetPath: '/home/eltmon/project/src/App.tsx:12:5',
  displayPath: 'project/src/App.tsx:12:5',
  basename: 'App.tsx',
  line: 12,
  column: 5,
};

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
    wsTransportMock.request.mockReset();
    wsTransportMock.request.mockImplementation((connect: (client: Record<string, unknown>) => unknown) => connect({
      [WS_METHODS.getAvailableEditors]: wsTransportMock.getAvailableEditors,
      [WS_METHODS.shellOpenInEditor]: wsTransportMock.shellOpenInEditor,
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
    localStorage.setItem('panopticon:last-editor', 'vscode');
    render(<MarkdownFileLink {...meta} />);

    fireEvent.click(screen.getByRole('link'));

    await waitFor(() => {
      expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({
        cwd: meta.targetPath,
        editor: 'vscode',
      });
    });
    expect(localStorage.getItem('panopticon:last-editor')).toBe('vscode');
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
    expect(localStorage.getItem('panopticon:last-editor')).toBe('vscode');
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
    localStorage.setItem('panopticon:last-editor', 'vscode');
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

  it('maps common file extensions to specialized icons and unknown files to a fallback', () => {
    expect(fileLinkIconForPath('/tmp/data.json').displayName ?? fileLinkIconForPath('/tmp/data.json').name).toBe('FileJson');
    expect(fileLinkIconForPath('/tmp/photo.png').displayName ?? fileLinkIconForPath('/tmp/photo.png').name).toBe('FileImage');
    expect(fileLinkIconForPath('/tmp/archive.zip').displayName ?? fileLinkIconForPath('/tmp/archive.zip').name).toBe('FileArchive');
    expect(fileLinkIconForPath('/tmp/unknown').displayName ?? fileLinkIconForPath('/tmp/unknown').name).toBe('File');
  });
});
