import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinearMcpAuthBanner, blockedAgentLink } from './LinearMcpAuthBanner';
import type { LinearMcpAuthStatus } from '../hooks/useLinearMcpAuthStatus';
import { useLinearConnectFlow, type LinearConnectFlow } from '../hooks/useLinearConnectFlow';
import { isLoopbackHost } from '../lib/loopbackHost';

vi.mock('../hooks/useLinearConnectFlow', () => ({
  useLinearConnectFlow: vi.fn(),
}));

vi.mock('../lib/loopbackHost', () => ({
  isLoopbackHost: vi.fn(() => true),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockFlow = vi.mocked(useLinearConnectFlow);
const mockLoopback = vi.mocked(isLoopbackHost);

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

const connect = vi.fn();
const checkNow = vi.fn();

function setFlow(overrides: Partial<LinearConnectFlow> = {}) {
  mockFlow.mockReturnValue({
    intervention: intervention(),
    phase: 'idle',
    fallbackUrl: null,
    notice: null,
    connect,
    checkNow,
    ...overrides,
  });
}

function setIntervention(value: LinearMcpAuthStatus | undefined) {
  setFlow({ intervention: value });
}

describe('LinearMcpAuthBanner', () => {
  beforeEach(() => {
    mockLoopback.mockReturnValue(true);
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

  it('renders every blocked agent with an issue view link and a tracker link', () => {
    setIntervention(intervention());
    render(<LinearMcpAuthBanner />);

    expect(screen.getByText(/Linear authentication required/)).toBeInTheDocument();

    // Work agents label by issue id and link the dashboard issue view; the
    // raw agent id rides in the title attribute.
    const minLink = screen.getByRole('link', { name: 'MIN-852' });
    expect(minLink).toHaveAttribute('href', '/issues/MIN-852');
    expect(minLink).toHaveAttribute('title', 'agent-min-852');
    expect(screen.getByRole('link', { name: 'PAN-2997' })).toHaveAttribute('href', '/issues/PAN-2997');

    // Every issue also gets a tracker icon link: the server-projected
    // canonical URL for Linear issues, the derived GitHub URL for PAN ones.
    const minTracker = screen.getByRole('link', { name: 'Open MIN-852 in tracker' });
    expect(minTracker).toHaveAttribute('href', 'https://linear.app/mind-your-now/issue/MIN-852/habits-full-bug-audit');
    expect(minTracker).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Open PAN-2997 in tracker' }))
      .toHaveAttribute('href', 'https://github.com/eltmon/overdeck/issues/2997');
  });

  it.each(['active', 'expired'] as const)('offers Connect Linear and no raw authorization link when %s', (status) => {
    setIntervention(intervention({ status }));
    render(<LinearMcpAuthBanner />);

    fireEvent.click(screen.getByRole('button', { name: /Connect Linear/ }));

    expect(connect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link', { name: /Open Linear authorization/ })).not.toBeInTheDocument();
  });

  it('explains that Connect Linear refreshes an expired link', () => {
    setIntervention(intervention({ status: 'expired' }));
    render(<LinearMcpAuthBanner />);
    expect(screen.getByText(/The last authorization link expired — Connect Linear gets a fresh one/)).toBeInTheDocument();
  });

  it('renders the authorization link when the popup was blocked', () => {
    setFlow({ phase: 'awaiting-approval', fallbackUrl: 'https://linear.app/oauth/authorize?state=fresh' });
    render(<LinearMcpAuthBanner />);

    const openAuth = screen.getByRole('link', { name: /Open Linear authorization/ });
    expect(openAuth).toHaveAttribute('href', 'https://linear.app/oauth/authorize?state=fresh');
    expect(openAuth).toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('button', { name: /Connect Linear/ })).not.toBeInTheDocument();
  });

  it.each([
    ['opening', 'Opening Linear…'],
    ['refreshing', 'Getting a fresh link…'],
    ['awaiting-approval', 'Approve access in the Linear tab, then come back here.'],
    ['checking', 'Checking Linear access…'],
  ] as const)('shows the %s progress copy and disables Connect Linear', (phase, copy) => {
    setFlow({ phase });
    render(<LinearMcpAuthBanner />);

    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect Linear/ })).toBeDisabled();
  });

  it('offers Check now while awaiting approval and shows the verify notice', () => {
    setFlow({ phase: 'awaiting-approval', notice: "Linear still isn't connected. Finish approving in the Linear tab, then click Check now." });
    render(<LinearMcpAuthBanner />);

    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));

    expect(checkNow).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Linear still isn't connected/)).toBeInTheDocument();
  });

  it('keeps the paste fallback collapsed on a loopback host and open on a remote one', () => {
    setIntervention(intervention());
    const { container, unmount } = render(<LinearMcpAuthBanner />);
    expect(screen.getByText('Signed in from a different device? Paste the callback URL')).toBeInTheDocument();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    unmount();

    mockLoopback.mockReturnValue(false);
    const remote = render(<LinearMcpAuthBanner />);
    expect(remote.container.querySelector('details')).toHaveAttribute('open');
  });

  it('labels a blocked conversation by its title and links its /conv/<rowid> view', () => {
    setIntervention(intervention({
      blockedAgents: [{
        agentId: 'conv-20261001-eba1',
        issueId: null,
        declaredAt: '2026-10-01T12:19:35Z',
        expiresAt: '2026-10-01T12:49:35Z',
        notifiedAt: null,
        issueUrl: null,
        conversationUrl: '/conv/3172',
        conversationTitle: 'Fernkite: hosted Emma assessment',
      }],
    }));
    render(<LinearMcpAuthBanner />);

    const convLink = screen.getByRole('link', { name: 'Fernkite: hosted Emma assessment' });
    expect(convLink).toHaveAttribute('href', '/conv/3172');
    expect(convLink).toHaveAttribute('title', 'conv-20261001-eba1');
  });

  it('renders an agent with neither a conversation nor an issue as plain text', () => {
    setIntervention(intervention({
      blockedAgents: [{
        agentId: 'agent-orphan',
        issueId: null,
        declaredAt: '2026-10-01T12:19:35Z',
        expiresAt: '2026-10-01T12:49:35Z',
        notifiedAt: null,
      }],
    }));
    render(<LinearMcpAuthBanner />);

    expect(screen.getByText('agent-orphan')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'agent-orphan' })).not.toBeInTheDocument();
  });

  it('blockedAgentLink prefers the conversation, then the issue view, then the raw id', () => {
    const base = { declaredAt: '', expiresAt: '', notifiedAt: null };
    expect(blockedAgentLink({ ...base, agentId: 'conv-x', issueId: null, conversationUrl: '/conv/1', conversationTitle: null }))
      .toEqual({ label: 'conv-x', href: '/conv/1' });
    expect(blockedAgentLink({ ...base, agentId: 'agent-min-852', issueId: 'MIN-852' }))
      .toEqual({ label: 'MIN-852', href: '/issues/MIN-852' });
    expect(blockedAgentLink({ ...base, agentId: 'agent-orphan', issueId: null }))
      .toEqual({ label: 'agent-orphan', href: null });
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

    fireEvent.click(screen.getByRole('button', { name: /Already authorized another way\? Mark completed/ }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/linear-mcp-auth/complete', expect.objectContaining({
        method: 'POST',
      }));
    });
  });
});
