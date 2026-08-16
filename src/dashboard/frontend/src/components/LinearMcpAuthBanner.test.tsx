import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinearMcpAuthBanner } from './LinearMcpAuthBanner';
import { useLinearMcpAuthStatus, type LinearMcpAuthStatus } from '../hooks/useLinearMcpAuthStatus';

vi.mock('../hooks/useLinearMcpAuthStatus', () => ({
  useLinearMcpAuthStatus: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockAuthStatus = vi.mocked(useLinearMcpAuthStatus);

function intervention(overrides: Partial<LinearMcpAuthStatus> = {}): LinearMcpAuthStatus {
  return {
    status: 'active',
    authUrl: 'https://linear.app/oauth/authorize?client_id=test&state=abc',
    authUrlAgentId: 'agent-min-852',
    authUrlExpiresAt: '2026-07-22T01:00:00Z',
    declaredAt: '2026-07-21T23:00:00Z',
    blockedAgents: [
      {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        declaredAt: '2026-07-21T23:00:00Z',
        expiresAt: '2026-07-22T01:00:00Z',
        notifiedAt: null,
        issueUrl: 'https://linear.app/mind-your-now/issue/MIN-852/habits-full-bug-audit',
      },
      {
        agentId: 'agent-pan-2997',
        issueId: 'PAN-2997',
        declaredAt: '2026-07-21T23:05:00Z',
        expiresAt: '2026-07-22T01:00:00Z',
        notifiedAt: null,
        issueUrl: null,
      },
    ],
    ...overrides,
  };
}

function setIntervention(value: LinearMcpAuthStatus | undefined) {
  mockAuthStatus.mockReturnValue({ data: value } as ReturnType<typeof useLinearMcpAuthStatus>);
}

describe('LinearMcpAuthBanner', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, relayedTo: 'agent-min-852' }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders nothing when the projection status is none', () => {
    setIntervention(intervention({ status: 'none', blockedAgents: [] }));
    const { container } = render(<LinearMcpAuthBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before the status query resolves', () => {
    setIntervention(undefined);
    const { container } = render(<LinearMcpAuthBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders every blocked agent with an issue link and the open-authorization action', () => {
    setIntervention(intervention());
    render(<LinearMcpAuthBanner />);

    expect(screen.getByText(/Linear authentication required/)).toBeInTheDocument();
    expect(screen.getByText('agent-min-852')).toBeInTheDocument();
    expect(screen.getByText('agent-pan-2997')).toBeInTheDocument();

    // Every blocked agent's issue renders as a link: the server-projected
    // canonical URL for Linear issues, the derived GitHub URL for PAN ones.
    const minLink = screen.getByRole('link', { name: 'MIN-852' });
    expect(minLink).toHaveAttribute('href', 'https://linear.app/mind-your-now/issue/MIN-852/habits-full-bug-audit');
    const panLink = screen.getByRole('link', { name: 'PAN-2997' });
    expect(panLink).toHaveAttribute('href', 'https://github.com/eltmon/overdeck/issues/2997');

    const openAuth = screen.getByRole('link', { name: /Open Linear authorization/ });
    expect(openAuth).toHaveAttribute('href', 'https://linear.app/oauth/authorize?client_id=test&state=abc');
    expect(openAuth).toHaveAttribute('target', '_blank');
    expect(openAuth.textContent).toContain('agent-min-852');
  });

  it('shows the expired state copy and no actionable stale link when the authorization link expired', () => {
    setIntervention(intervention({ status: 'expired' }));
    render(<LinearMcpAuthBanner />);
    expect(screen.getByText(/This authorization link expired/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open Linear authorization/ })).not.toBeInTheDocument();
  });

  it('links a blocked conversation agent to its canonical /conv/<rowid> view', () => {
    setIntervention(intervention({
      blockedAgents: [{
        agentId: 'conv-20260815-f8c3',
        issueId: null,
        declaredAt: '2026-08-15T12:19:35Z',
        expiresAt: '2026-08-15T16:52:22Z',
        notifiedAt: null,
        issueUrl: null,
        conversationUrl: '/conv/173',
      }],
    }));
    render(<LinearMcpAuthBanner />);

    const convLink = screen.getByRole('link', { name: 'conv-20260815-f8c3' });
    expect(convLink).toHaveAttribute('href', '/conv/173');
    // Agents with no conversation page keep plain-text ids.
    setIntervention(intervention());
    render(<LinearMcpAuthBanner />);
    expect(screen.queryByRole('link', { name: 'agent-min-852' })).not.toBeInTheDocument();
    expect(screen.getByText('agent-min-852')).toBeInTheDocument();
  });

  it('shows the waiting-for-URL state when no agent has produced an authorization URL', () => {
    setIntervention(intervention({ authUrl: null, authUrlAgentId: null }));
    render(<LinearMcpAuthBanner />);
    expect(screen.getByText(/Waiting for a blocked agent to produce an authorization URL/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open Linear authorization/ })).not.toBeInTheDocument();
  });

  it('submits the entered callback URL to the callback route', async () => {
    setIntervention(intervention());
    render(<LinearMcpAuthBanner />);

    fireEvent.change(screen.getByPlaceholderText(/Paste the localhost callback URL/), {
      target: { value: 'http://localhost:48271/callback?code=abc&state=xyz' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit callback URL/ }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/linear-mcp-auth/callback', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ callbackUrl: 'http://localhost:48271/callback?code=abc&state=xyz' }),
      }));
    });
  });

  it('mark-completed POSTs to the complete route and explains the wake consequence', async () => {
    setIntervention(intervention());
    render(<LinearMcpAuthBanner />);

    expect(screen.getByText(/blocked agents will be woken to re-check/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Mark completed/ }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/linear-mcp-auth/complete', expect.objectContaining({
        method: 'POST',
      }));
    });
  });
});
