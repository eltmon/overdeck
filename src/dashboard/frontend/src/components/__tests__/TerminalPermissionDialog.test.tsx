/**
 * PAN-4278 — TerminalPermissionDialog rendering and the dialog hook's
 * answer / "Confirming…" lifecycle.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const respondToTerminalPermission = vi.hoisted(() => vi.fn());
vi.mock('../../App/api', () => ({ respondToTerminalPermission }));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import {
  TerminalPermissionDialog,
  type TerminalPendingPermission,
  type TerminalPermissionSubject,
} from '../TerminalPermissionDialog';
import {
  useTerminalPermissionDialog,
  type TerminalPermissionFeedRow,
} from '../../App/hooks/useTerminalPermissionDialog';

const DANGEROUS_RM: TerminalPendingPermission = {
  signature: 'Bash command · from the general-purpose agent::rm::1:Yes|2:No',
  answerable: true,
  agentLabel: 'Subagent: Research Orca onboarding flow',
  agentKey: 'a9ef',
  toolName: 'Bash',
  header: 'Bash command',
  clipped: false,
  inputPreview: null,
  detailLines: ['Q=$(pwd)/queue; rm -f "$Q"/*', 'Clear scratch queue files'],
  reason: 'Dangerous rm operation on possibly-empty variable path: "$Q"/*',
  options: [{ choice: 'allow-once', label: 'Yes' }, { choice: 'deny', label: 'No' }],
  since: '2026-09-27T15:32:21.000Z',
};

const THREE_OPTIONS: TerminalPendingPermission = {
  ...DANGEROUS_RM,
  signature: 'Bash command::touch::1:Yes|2:Yes, and always allow|3:No',
  agentLabel: 'Main agent',
  agentKey: 'main',
  reason: null,
  options: [
    { choice: 'allow-once', label: 'Yes' },
    { choice: 'allow-always', label: 'Yes, and always allow access to /tmp from this project' },
    { choice: 'deny', label: 'No' },
  ],
};

function subject(pendingPermission: TerminalPendingPermission): TerminalPermissionSubject {
  return { conversationName: '20260927-3978', title: 'Orca study', pendingPermission };
}

function renderDialog(pendingPermission: TerminalPendingPermission, props: Partial<Parameters<typeof TerminalPermissionDialog>[0]> = {}) {
  const handlers = { onAnswer: vi.fn(), onOpenTerminal: vi.fn(), onDismiss: vi.fn() };
  render(<TerminalPermissionDialog subject={subject(pendingPermission)} isOpen {...handlers} {...props} />);
  return handlers;
}

describe('TerminalPermissionDialog', () => {
  it('renders command, reason and subagent label', () => {
    renderDialog(DANGEROUS_RM);
    expect(screen.getByText('Permission needed')).toBeInTheDocument();
    expect(screen.getByText('Orca study')).toBeInTheDocument();
    expect(screen.getByText('Subagent: Research Orca onboarding flow')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText(/rm -f "\$Q"\/\*\s+Clear scratch queue files/)).toBeInTheDocument();
    expect(screen.getByText(/^Dangerous rm operation/)).toBeInTheDocument();
  });

  it('hides Allow always for a 2-option prompt', () => {
    renderDialog(DANGEROUS_RM);
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow always' })).toBeNull();
  });

  it('shows Allow always when the prompt offers it', () => {
    renderDialog(THREE_OPTIONS);
    expect(screen.getByRole('button', { name: 'Allow always' })).toBeInTheDocument();
  });

  it('non-answerable shows only Open terminal', () => {
    const handlers = renderDialog({ ...DANGEROUS_RM, answerable: false, signature: null, options: [] });
    expect(screen.getByText(/open the terminal and answer it there/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }));
    expect(handlers.onOpenTerminal).toHaveBeenCalled();
  });

  it('shows the start of a clipped command and the visible part', () => {
    renderDialog({
      ...DANGEROUS_RM,
      clipped: true,
      inputPreview: 'S=/tmp/x; node shoot2.cjs',
      detailLines: ['sleep 20'],
    });
    expect(screen.getByText('Command (start)')).toBeInTheDocument();
    expect(screen.getByText('On screen')).toBeInTheDocument();
    expect(screen.getByText('S=/tmp/x; node shoot2.cjs')).toBeInTheDocument();
    expect(screen.getByText('sleep 20')).toBeInTheDocument();
    expect(screen.getByText(/scrolled off the agent's screen/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('non-answerable prompt says to answer in the terminal and makes Open terminal primary', () => {
    renderDialog({ ...DANGEROUS_RM, answerable: false, signature: null, options: [] });
    expect(screen.getByText(/open the terminal and answer it there/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open terminal' })).toHaveClass('bg-warning');
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
  });

  it('disables the answers while confirming', () => {
    renderDialog(DANGEROUS_RM, { confirming: true });
    expect(screen.getByText('Confirming…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
  });
});

describe('useTerminalPermissionDialog', () => {
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    queryClient = new QueryClient();
    respondToTerminalPermission.mockReset();
  });

  const rows = (pendingPermission?: TerminalPendingPermission): TerminalPermissionFeedRow[] => [
    { name: '20260927-3978', title: 'Orca study', ...(pendingPermission ? { pendingPermission } : {}) },
  ];

  it('Deny posts choice deny with the signature', async () => {
    respondToTerminalPermission.mockResolvedValue({ ok: true, status: 200 });
    const { result } = renderHook(() => useTerminalPermissionDialog(rows(DANGEROUS_RM), false), { wrapper });
    act(() => result.current.onAnswer('deny'));
    await waitFor(() => expect(respondToTerminalPermission).toHaveBeenCalledWith('20260927-3978', DANGEROUS_RM.signature, 'deny'));
  });

  it('stays open in Confirming… until the feed drops the signature', async () => {
    respondToTerminalPermission.mockResolvedValue({ ok: true, status: 200 });
    const { result, rerender } = renderHook(
      ({ feed }: { feed: TerminalPermissionFeedRow[] }) => useTerminalPermissionDialog(feed, false),
      { wrapper, initialProps: { feed: rows(DANGEROUS_RM) } },
    );
    act(() => result.current.onAnswer('allow-once'));
    await waitFor(() => expect(result.current.confirming).toBe(true));
    expect(result.current.isOpen).toBe(true);

    rerender({ feed: rows(DANGEROUS_RM) });
    expect(result.current.confirming).toBe(true);
    expect(result.current.isOpen).toBe(true);

    rerender({ feed: rows() });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.confirming).toBe(false);
  });

  it('does not confirm when the prompt changed on screen', async () => {
    respondToTerminalPermission.mockResolvedValue({ ok: false, status: 409, code: 'prompt-changed' });
    const { result } = renderHook(() => useTerminalPermissionDialog(rows(DANGEROUS_RM), false), { wrapper });
    act(() => result.current.onAnswer('deny'));
    await waitFor(() => expect(result.current.isSubmitting).toBe(false));
    expect(respondToTerminalPermission).toHaveBeenCalled();
    expect(result.current.confirming).toBe(false);
    expect(result.current.isOpen).toBe(true);
  });

  it('stays closed while a channel permission request shows, and Dismiss hides the prompt', () => {
    const blocked = renderHook(() => useTerminalPermissionDialog(rows(DANGEROUS_RM), true), { wrapper });
    expect(blocked.result.current.isOpen).toBe(false);

    const { result } = renderHook(() => useTerminalPermissionDialog(rows(DANGEROUS_RM), false), { wrapper });
    act(() => result.current.onDismiss());
    expect(result.current.isOpen).toBe(false);
  });

  it('Open terminal navigates to the conversation terminal view (PAN-4466)', () => {
    window.history.pushState({}, '', '/');
    const { result } = renderHook(() => useTerminalPermissionDialog(rows(DANGEROUS_RM), false), { wrapper });
    act(() => result.current.onOpenTerminal());
    expect(window.location.pathname + window.location.search).toBe('/conv/20260927-3978?view=terminal');
  });
});
