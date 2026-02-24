import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { TerminalPanel } from './TerminalPanel';
import { Agent } from '../types';

// jsdom does not implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const mockAgent: Agent = {
  id: 'agent-123',
  name: 'test-agent',
  status: 'working',
  issueId: 'PAN-999',
  sessionName: 'test-session',
  model: 'claude-sonnet-4-6',
  startedAt: new Date().toISOString(),
  restartCount: 0,
  runtime: 'claude-code',
};

const stoppedAgent: Agent = {
  ...mockAgent,
  status: 'stopped',
};

describe('TerminalPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/output')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ output: 'Agent started\nRunning task...' }),
        });
      }
      if (url.includes('/message')) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    }));
  });

  it('renders Logs and Status tabs', () => {
    render(<TerminalPanel agent={mockAgent} onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Logs')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('shows Logs tab as active by default', () => {
    render(<TerminalPanel agent={mockAgent} onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    const logsTab = screen.getByText('Logs');
    expect(logsTab).toBeInTheDocument();
  });

  it('switches to Status tab when clicked', async () => {
    const user = userEvent.setup();
    render(<TerminalPanel agent={mockAgent} onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await user.click(screen.getByText('Status'));
    // Status tab content should be visible — model info
    await waitFor(() => {
      expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument();
    });
  });

  it('shows terminal output from API', async () => {
    render(<TerminalPanel agent={mockAgent} onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(screen.getByText(/Agent started/)).toBeInTheDocument();
    });
  });

  it('shows chat input for running agent', () => {
    render(<TerminalPanel agent={mockAgent} onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByPlaceholderText('Send message to agent...')).toBeInTheDocument();
  });

  it('hides chat input for stopped agent', () => {
    render(<TerminalPanel agent={stoppedAgent} onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });
    expect(screen.queryByPlaceholderText('Send message to agent...')).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TerminalPanel agent={mockAgent} onClose={onClose} />, {
      wrapper: createWrapper(),
    });
    const closeButton = screen.getByTitle('Close terminal');
    await user.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it('sends a message when send button is clicked', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock.mockImplementation((url: string) => {
      if (url.includes('/output')) {
        return Promise.resolve({ ok: true, json: async () => ({ output: '' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(<TerminalPanel agent={mockAgent} onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    });

    const input = screen.getByPlaceholderText('Send message to agent...');
    await user.type(input, 'Hello agent');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      const calls = fetchMock.mock.calls;
      const messageSent = calls.some(([url, opts]: [string, RequestInit]) =>
        url.includes('/message') && opts?.body?.toString().includes('Hello agent')
      );
      expect(messageSent).toBe(true);
    });
  });
});
