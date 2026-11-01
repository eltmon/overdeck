/** PAN-4650 WI-20: in remote mode the picker opens the owner's checkout over remote SSH. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json' })),
  getTransport: () => ({ request: vi.fn(() => new Promise(() => undefined)) }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { PanOpenInPicker, REMOTE_EDITOR_UNSUPPORTED_HINT } from '../PanOpenInPicker';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, commandLine: 'code --remote ssh-remote+desk.tail1234.ts.net /home/desk/proj' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('PanOpenInPicker remote mode (PAN-4650 WI-20)', () => {
  it('ac4: lists VS Code, Insiders and VSCodium, with Cursor and Windsurf disabled and explained', () => {
    render(<PanOpenInPicker openInCwd="/ignored" remote={{ conversation: '@env-desk/conv-x' }} />);
    fireEvent.click(screen.getByLabelText('Open in editor over remote SSH'));
    const list = screen.getByTestId('remote-editor-list');
    for (const name of ['VS Code', 'VS Code Insiders', 'VSCodium']) expect(screen.getByRole('button', { name })).toBeEnabled();
    for (const name of ['Cursor', 'Windsurf']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', REMOTE_EDITOR_UNSUPPORTED_HINT);
    }
    expect(list.textContent).toContain('--remote ssh-remote+');
  });

  it('posts the linked conversation and editor, then shows the command it ran', async () => {
    render(<PanOpenInPicker openInCwd="/ignored" remote={{ conversation: '@env-desk/conv-x' }} />);
    fireEvent.click(screen.getByLabelText('Open in editor over remote SSH'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'VS Code' })); });
    expect(fetchMock).toHaveBeenCalledWith('/api/linked-conversations/open-in-editor', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ conversation: '@env-desk/conv-x', editor: 'vscode' }),
    }));
    expect(screen.getByTestId('remote-editor-command').textContent).toBe('code --remote ssh-remote+desk.tail1234.ts.net /home/desk/proj');
  });
});
