/** PAN-5291 D1-5: the ⋯ menu's Open folder in <Editor> items. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WS_METHODS } from '@overdeck/contracts';

const wsTransportMock = vi.hoisted(() => ({
  request: vi.fn(),
  getAvailableEditors: vi.fn(),
  shellOpenInEditor: vi.fn(),
}));

vi.mock('../../../../lib/wsTransport', () => ({
  getTransport: () => wsTransportMock,
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json' })),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { OpenFolderMenuItems } from '../OpenFolderMenuItems';
import type { Conversation } from '../../../CommandDeck/ConversationList';

const CONVERSATION = {
  id: 1,
  name: 'conv-1',
  tmuxSession: 'conv-1',
  status: 'ended',
  cwd: '/home/u/p',
  issueId: null,
  createdAt: '2026-11-15T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: false,
} as unknown as Conversation;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  wsTransportMock.getAvailableEditors.mockReset();
  wsTransportMock.getAvailableEditors.mockResolvedValue({ editors: ['cursor', 'vscode'], defaultCwd: '/home/u/Projects' });
  wsTransportMock.shellOpenInEditor.mockReset();
  wsTransportMock.shellOpenInEditor.mockResolvedValue({ success: true });
  wsTransportMock.request.mockReset();
  wsTransportMock.request.mockImplementation((connect: (client: Record<string, unknown>) => unknown) => connect({
    [WS_METHODS.getAvailableEditors]: wsTransportMock.getAvailableEditors,
    [WS_METHODS.shellOpenInEditor]: wsTransportMock.shellOpenInEditor,
  }));
  fetchMock = vi.fn(async () => Response.json({ ok: true, commandLine: 'code --remote ssh-remote+desk /home/desk/p' }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('OpenFolderMenuItems', () => {
  it('lists the preferred editor first and opens the folder in the clicked editor', async () => {
    localStorage.setItem('overdeck:last-editor', 'vscode');
    const onDone = vi.fn();
    render(<OpenFolderMenuItems conversation={CONVERSATION} onDone={onDone} />);

    await screen.findByRole('menuitem', { name: /Open folder in Cursor/ });
    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(labels[0]).toMatch(/^Open folder in VS Code/);
    expect(labels[1]).toMatch(/^Open folder in Cursor/);

    fireEvent.click(screen.getByRole('menuitem', { name: /Open folder in Cursor/ }));
    await waitFor(() => expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({ cwd: '/home/u/p', editor: 'cursor' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('lists the remote SSH editors for a linked conversation, with Cursor and Windsurf disabled', async () => {
    const onDone = vi.fn();
    render(<OpenFolderMenuItems conversation={{ ...CONVERSATION, name: '@desk/conv-x', origin: 'linked' } as Conversation} onDone={onDone} />);

    for (const name of ['VS Code', 'VS Code Insiders', 'VSCodium']) {
      expect(screen.getByRole('menuitem', { name: `Open folder in ${name} (remote SSH)` })).toBeEnabled();
    }
    for (const name of ['Cursor', 'Windsurf']) {
      expect(screen.getByRole('menuitem', { name: `Open folder in ${name} (remote SSH)` })).toBeDisabled();
    }

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open folder in VS Code (remote SSH)' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/linked-conversations/open-in-editor');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ conversation: '@desk/conv-x', editor: 'vscode' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when no editor is available', async () => {
    wsTransportMock.getAvailableEditors.mockResolvedValue({ editors: [], defaultCwd: '/home/u/Projects' });
    const { container } = render(<OpenFolderMenuItems conversation={CONVERSATION} onDone={vi.fn()} />);
    await waitFor(() => expect(wsTransportMock.getAvailableEditors).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
