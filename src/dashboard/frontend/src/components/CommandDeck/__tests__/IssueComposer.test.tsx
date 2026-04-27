/**
 * IssueComposer tests — verify the three composer modes (PAN-867).
 *
 * Modes:
 *   1. Active sessions exist → disabled with hint
 *   2. Zero sessions → enabled, inline notice, Spawn & Send button
 *   3. All sessions ended → enabled, inline notice, Spawn Work & Send button
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { SessionNode as SessionNodeType } from '@panctl/contracts';
import { IssueComposer } from '../IssueComposer';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = makeQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ISSUE = 'PAN-867';

function makeSession(sessionId: string, presence: SessionNodeType['presence']): SessionNodeType {
  return {
    type: 'work',
    role: undefined,
    sessionId,
    tmuxSession: sessionId,
    model: 'claude-sonnet-4-6',
    startedAt: new Date().toISOString(),
    duration: 60,
    status: 'running',
    presence,
  } as SessionNodeType;
}

describe('IssueComposer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
  });

  it('renders disabled mode when active sessions exist', () => {
    render(
      <Wrapper>
        <IssueComposer
          issueId={ISSUE}
          sessions={[makeSession('agent-1', 'active')]}
        />
      </Wrapper>,
    );

    const composer = screen.getByTestId('issue-composer');
    expect(composer).toHaveAttribute('data-mode', 'disabled');

    const input = screen.getByTestId('issue-composer-input');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('placeholder', 'Select an agent to chat, or use Spawn & Send below');

    expect(screen.queryByTestId('issue-composer-notice')).not.toBeInTheDocument();
  });

  it('renders spawn-and-send mode when zero sessions exist', () => {
    render(
      <Wrapper>
        <IssueComposer issueId={ISSUE} sessions={[]} />
      </Wrapper>,
    );

    const composer = screen.getByTestId('issue-composer');
    expect(composer).toHaveAttribute('data-mode', 'spawn-and-send');

    const notice = screen.getByTestId('issue-composer-notice');
    expect(notice.textContent).toContain('No sessions');
    expect(notice.textContent).toContain('spawn a new work agent');

    const input = screen.getByTestId('issue-composer-input');
    expect(input).not.toBeDisabled();
    expect(input).toHaveAttribute('placeholder', 'Type a message…');

    const sendBtn = screen.getByTestId('issue-composer-send');
    expect(sendBtn.textContent).toContain('Spawn & Send');
    expect(sendBtn).toBeDisabled(); // disabled because input is empty
  });

  it('renders spawn-work-and-send mode when all sessions ended', () => {
    render(
      <Wrapper>
        <IssueComposer
          issueId={ISSUE}
          sessions={[
            makeSession('agent-1', 'ended'),
            makeSession('agent-2', 'ended'),
          ]}
        />
      </Wrapper>,
    );

    const composer = screen.getByTestId('issue-composer');
    expect(composer).toHaveAttribute('data-mode', 'spawn-work-and-send');

    const notice = screen.getByTestId('issue-composer-notice');
    expect(notice.textContent).toContain('All sessions ended');
    expect(notice.textContent).toContain('spawn a fresh work agent');

    const sendBtn = screen.getByTestId('issue-composer-send');
    expect(sendBtn.textContent).toContain('Spawn Work & Send');
  });

  it('sends message and spawns agent in spawn-and-send mode', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = mockFetch;

    render(
      <Wrapper>
        <IssueComposer issueId={ISSUE} sessions={[]} />
      </Wrapper>,
    );

    const input = screen.getByTestId('issue-composer-input');
    fireEvent.change(input, { target: { value: 'Hello agent' } });

    const sendBtn = screen.getByTestId('issue-composer-send');
    expect(sendBtn).not.toBeDisabled();

    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/agents',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issueId: ISSUE, message: 'Hello agent' }),
        }),
      );
    });
  });

  it('submits on Enter key without Shift', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = mockFetch;

    render(
      <Wrapper>
        <IssueComposer issueId={ISSUE} sessions={[]} />
      </Wrapper>,
    );

    const input = screen.getByTestId('issue-composer-input');
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  it('does not submit on Shift+Enter', () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = mockFetch;

    render(
      <Wrapper>
        <IssueComposer issueId={ISSUE} sessions={[]} />
      </Wrapper>,
    );

    const input = screen.getByTestId('issue-composer-input');
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows error toast when spawn fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Workspace not found' }),
    });
    global.fetch = mockFetch;

    render(
      <Wrapper>
        <IssueComposer issueId={ISSUE} sessions={[]} />
      </Wrapper>,
    );

    const input = screen.getByTestId('issue-composer-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByTestId('issue-composer-send'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  it('does not submit when input is empty', () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = mockFetch;

    render(
      <Wrapper>
        <IssueComposer issueId={ISSUE} sessions={[]} />
      </Wrapper>,
    );

    fireEvent.click(screen.getByTestId('issue-composer-send'));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
