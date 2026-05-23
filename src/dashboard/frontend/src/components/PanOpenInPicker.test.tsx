import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_METHODS } from '@panctl/contracts';

const wsTransportMock = vi.hoisted(() => ({
  request: vi.fn(),
  getAvailableEditors: vi.fn(),
  shellOpenInEditor: vi.fn(),
}));

vi.mock('../lib/wsTransport', () => ({
  getTransport: () => wsTransportMock,
}));

import { PanOpenInPicker } from './PanOpenInPicker';
import { EDITOR_OPEN_FAVORITE_KEY } from '../lib/keybindings';

describe('PanOpenInPicker keyboard shortcut', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
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

  it('shows the shortcut in the primary button tooltip', async () => {
    render(<PanOpenInPicker cwd="/tmp/workspace" />);

    expect(await screen.findByRole('button', { name: 'Cursor' })).toHaveAttribute('title', 'Open in Cursor (⌘⇧O)');
    expect(EDITOR_OPEN_FAVORITE_KEY).toBe('mod+shift+o');
  });

  it('opens the preferred editor from Ctrl+Shift+O while mounted', async () => {
    localStorage.setItem('panopticon:last-editor', 'vscode');
    render(<PanOpenInPicker cwd="/tmp/workspace" />);
    await screen.findByRole('button', { name: 'VS Code' });

    fireEvent.keyDown(document.body, { key: 'O', ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({
        cwd: '/tmp/workspace',
        editor: 'vscode',
      });
    });
  });

  it('does not fire the shortcut after the picker unmounts', async () => {
    const rendered = render(<PanOpenInPicker cwd="/tmp/workspace" />);
    await screen.findByRole('button', { name: 'Cursor' });

    rendered.unmount();
    fireEvent.keyDown(document.body, { key: 'O', metaKey: true, shiftKey: true });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wsTransportMock.shellOpenInEditor).not.toHaveBeenCalled();
  });
});
