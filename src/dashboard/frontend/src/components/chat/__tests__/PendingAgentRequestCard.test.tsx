/**
 * PAN-5541 WI-6: the pinned agent-request card — `isOwnedBy`'s D7 owner
 * match, and `PendingAgentRequestCards` rendering `AgentRequestCard` for
 * exactly the requests owned by its chrome.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../lib/wsTransport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/wsTransport')>()),
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json' })),
}));

import { isOwnedBy, PendingAgentRequestCards } from '../PendingAgentRequestCard';
import { ANYWHERE_STATUS_QUERY_KEY } from '../../Settings/anywhere/anywhereApi';
import type { AgentRequestRow, Decision } from '../../../lib/useDecisions';

const secretRequest: NonNullable<Decision['agentRequest']> = {
  id: 'req-1',
  kind: 'secret',
  name: 'OPENAI_API_KEY',
  prompt: 'The key for the eval run',
  agentId: 'alpha',
  agentKind: 'conversation',
  issueId: 'PAN-1',
  expiresAt: '2026-11-04T00:10:00.000Z',
};

const row: AgentRequestRow = {
  id: 'req-1',
  kind: 'secret',
  agentId: 'alpha',
  agentKind: 'conversation',
  issueId: 'PAN-1',
  label: 'alpha',
  name: 'OPENAI_API_KEY',
  prompt: 'The key for the eval run',
  createdAt: '2026-11-04T00:00:00.000Z',
  expiresAt: '2026-11-04T00:10:00.000Z',
};

function renderFor(owner: Parameters<typeof PendingAgentRequestCards>[0]['owner'], rows: AgentRequestRow[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['agent-requests'], rows);
  client.setQueryData(ANYWHERE_STATUS_QUERY_KEY, { machine: { environmentId: 'env-1', label: 'desk' }, viewer: { kind: 'root-session' } });
  return render(<QueryClientProvider client={client}><PendingAgentRequestCards owner={owner} /></QueryClientProvider>);
}

describe('isOwnedBy (D7)', () => {
  it('matches an agent-owned request case-insensitively by id', () => {
    const request = { ...secretRequest, agentId: 'agent-pan-7', agentKind: 'agent' as const };
    expect(isOwnedBy(request, { kind: 'agent', id: 'AGENT-PAN-7' })).toBe(true);
    expect(isOwnedBy(request, { kind: 'conversation', name: 'agent-pan-7' })).toBe(false);
  });

  it('matches a conversation-owned request by exact name', () => {
    expect(isOwnedBy(secretRequest, { kind: 'conversation', name: 'alpha' })).toBe(true);
    expect(isOwnedBy(secretRequest, { kind: 'conversation', name: 'beta' })).toBe(false);
    expect(isOwnedBy(secretRequest, { kind: 'agent', id: 'alpha' })).toBe(false);
  });
});

describe('PendingAgentRequestCards (PAN-5541 WI-6)', () => {
  it('renders the password input inside data-testid="pinned-agent-requests" for the owning conversation (AC1)', () => {
    renderFor({ kind: 'conversation', name: 'alpha' }, [row]);
    expect(screen.getByTestId('pinned-agent-requests')).toBeInTheDocument();
    expect(screen.getByLabelText('Value for OPENAI_API_KEY')).toBeInTheDocument();
  });

  it('renders nothing for a request owned by another conversation (AC2)', () => {
    renderFor({ kind: 'conversation', name: 'beta' }, [row]);
    expect(screen.queryByTestId('pinned-agent-requests')).toBeNull();
  });
});
