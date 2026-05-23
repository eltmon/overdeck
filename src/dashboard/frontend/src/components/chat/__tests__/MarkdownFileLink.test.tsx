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

  it('maps common file extensions to specialized icons and unknown files to a fallback', () => {
    expect(fileLinkIconForPath('/tmp/data.json').displayName ?? fileLinkIconForPath('/tmp/data.json').name).toBe('FileJson');
    expect(fileLinkIconForPath('/tmp/photo.png').displayName ?? fileLinkIconForPath('/tmp/photo.png').name).toBe('FileImage');
    expect(fileLinkIconForPath('/tmp/archive.zip').displayName ?? fileLinkIconForPath('/tmp/archive.zip').name).toBe('FileArchive');
    expect(fileLinkIconForPath('/tmp/unknown').displayName ?? fileLinkIconForPath('/tmp/unknown').name).toBe('File');
  });
});
