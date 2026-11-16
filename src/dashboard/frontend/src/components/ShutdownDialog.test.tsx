/**
 * PAN-5342 WI-10 — the shutdown confirmation. fetch is stubbed: no test calls a
 * real dashboard route or starts a real shutdown.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }));

import { SHUTDOWN_OPEN_EVENT, ShutdownDialog, ShutdownSystemControl, triggerShutdownDialog } from './ShutdownDialog';

interface Call { url: string; method: string; body: unknown }

const PREVIEW = {
  agents: 3,
  conversations: 2,
  workingNow: 1,
  writers: [{ kind: 'auto-merge', label: 'Merging PAN-7' }],
  restartInProgress: null as { pid: number } | null,
};

let calls: Call[];
let preview: typeof PREVIEW;
let postResponse: () => Response;

beforeEach(() => {
  calls = [];
  preview = { ...PREVIEW };
  postResponse = () => new Response(null, { status: 202 });
  toastError.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'GET' && url === '/api/shutdown/preview') return Response.json(preview);
    if (method === 'POST' && url === '/api/shutdown') return postResponse();
    throw new Error(`unexpected request ${method} ${url}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openDialog() {
  render(<ShutdownDialog />);
  act(() => triggerShutdownDialog());
  await screen.findByTestId('shutdown-preview');
}

describe('ShutdownDialog', () => {
  it('renders nothing until opened, then shows the preview counts and the writers', async () => {
    const { unmount } = render(<ShutdownDialog />);
    expect(screen.queryByTestId('shutdown-dialog')).toBeNull();
    unmount();

    await openDialog();
    expect(screen.getByTestId('shutdown-preview')).toHaveTextContent(
      'Each agent finishes the tool call it is running. Then Overdeck stops 3 agents and 2 conversations (1 working now), the dashboard and its services. Nothing is killed unless you force it. Deadline: 2 minutes.',
    );
    expect(screen.getByTestId('shutdown-writers')).toHaveTextContent('Merging PAN-7');
    expect(calls).toEqual([{ url: '/api/shutdown/preview', method: 'GET', body: undefined }]);
  });

  it('sends reboot: true when "Reboot when done" is checked, then closes', async () => {
    await openDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reboot when done' }));
    fireEvent.click(screen.getByTestId('shutdown-confirm'));

    await waitFor(() => expect(screen.queryByTestId('shutdown-dialog')).toBeNull());
    expect(calls.at(-1)).toEqual({ url: '/api/shutdown', method: 'POST', body: { reboot: true } });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('sends reboot: false by default', async () => {
    await openDialog();
    fireEvent.click(screen.getByTestId('shutdown-confirm'));
    await waitFor(() => expect(screen.queryByTestId('shutdown-dialog')).toBeNull());
    expect(calls.at(-1)).toEqual({ url: '/api/shutdown', method: 'POST', body: { reboot: false } });
  });

  it('disables Shut down and says why while a reload or restart is in progress', async () => {
    preview = { ...PREVIEW, restartInProgress: { pid: 4242 } };
    await openDialog();
    expect(screen.getByTestId('shutdown-confirm')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('A pan reload or restart is in progress. Wait for it to finish.');
    fireEvent.click(screen.getByTestId('shutdown-confirm'));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('toasts the route error on a 409', async () => {
    postResponse = () => Response.json({ error: 'A shutdown is already running.', code: 'already-running' }, { status: 409 });
    await openDialog();
    fireEvent.click(screen.getByTestId('shutdown-confirm'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('A shutdown is already running.'));
  });

  it('opens from the System controls button through the window event', async () => {
    const opened = vi.fn();
    window.addEventListener(SHUTDOWN_OPEN_EVENT, opened);
    render(<><ShutdownSystemControl /><ShutdownDialog /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Shut down Overdeck…' }));
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener(SHUTDOWN_OPEN_EVENT, opened);
    await screen.findByTestId('shutdown-preview');
  });
});
