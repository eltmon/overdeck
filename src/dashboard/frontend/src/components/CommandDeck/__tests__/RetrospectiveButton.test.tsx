/**
 * RetrospectiveButton tests (PAN-3841): menu behavior, POST shape,
 * navigation on success, toast + re-enable on failure, disabled state.
 *
 * The dashboard's established mutation contract requires the companion
 * route to receive a session cookie + CSRF header (or an internal token).
 * We mock dashboardMutationJsonHeaders so the test doesn't need to bootstrap
 * a real wsTransport session, and assert the button goes through that path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RetrospectiveButton } from '../RetrospectiveButton';

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

const dashboardMutationJsonHeaders = vi.fn(async () => ({
  'Content-Type': 'application/json',
  'x-overdeck-csrf-token': 'test-csrf',
}));
vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: (...args: unknown[]) => dashboardMutationJsonHeaders(...args),
}));

const assignMock = vi.fn();

beforeEach(() => {
  toastError.mockClear();
  assignMock.mockClear();
  dashboardMutationJsonHeaders.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: assignMock },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RetrospectiveButton', () => {
  it('renders the button and opens the window menu on click', () => {
    render(<RetrospectiveButton model="claude-opus-4-6" harness="claude-code" />);
    const button = screen.getByRole('button', { name: 'Pipeline retrospective' });
    expect(button).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole('menuitem', { name: 'Last 24 hours' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Last 7 days' })).toBeTruthy();
  });

  it('POSTs the chosen window with dashboard mutation headers and navigates to the new conversation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ id: 42, name: 'conv-test-42' })),
    );
    render(<RetrospectiveButton model="claude-opus-4-6" harness="claude-code" />);
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline retrospective' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Last 7 days' }));

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/conv/conv-test-42'));
    expect(dashboardMutationJsonHeaders).toHaveBeenCalledWith();
    expect(fetch).toHaveBeenCalledWith('/api/conversations/retrospective', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-overdeck-csrf-token': 'test-csrf',
      },
      body: JSON.stringify({ window: '7d', model: 'claude-opus-4-6', harness: 'claude-code' }),
    });
  });

  it('toasts the server error and re-enables the button on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'boom' }, { status: 500 })),
    );
    render(<RetrospectiveButton model="claude-opus-4-6" harness="claude-code" />);
    const button = screen.getByRole('button', { name: 'Pipeline retrospective' });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Last 24 hours' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('boom'));
    expect(assignMock).not.toHaveBeenCalled();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('is disabled when no model is selected', () => {
    render(<RetrospectiveButton model="" />);
    const button = screen.getByRole('button', { name: 'Pipeline retrospective' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
