import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ConversationSearchBanner } from '../ConversationSearchBanner';
import { useConversationSearchStatus, type ConversationSearchStatus } from '../../hooks/useConversationSearchStatus';

vi.mock('../../hooks/useConversationSearchStatus', () => ({
  useConversationSearchStatus: vi.fn(),
}));

const mockUseStatus = vi.mocked(useConversationSearchStatus);

function makeStatus(overrides: Partial<ConversationSearchStatus> = {}): ConversationSearchStatus {
  return {
    enabled: true,
    available: true,
    dbPath: '/tmp/embeddings.db',
    chunkCount: 10,
    indexedFileCount: 2,
    lastIndexedAt: null,
    health: { lastErrorAt: null, lastErrorReason: null, lastSuccessAt: null },
    ...overrides,
  };
}

describe('ConversationSearchBanner', () => {
  beforeEach(() => {
    mockUseStatus.mockReturnValue({ data: undefined } as ReturnType<typeof useConversationSearchStatus>);
  });

  it('renders nothing while status is loading', () => {
    const { container } = render(<ConversationSearchBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when search is healthy and enabled', () => {
    mockUseStatus.mockReturnValue({ data: makeStatus() } as ReturnType<typeof useConversationSearchStatus>);
    const { container } = render(<ConversationSearchBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when conversation search is disabled by config', () => {
    mockUseStatus.mockReturnValue({ data: makeStatus({ enabled: false }) } as ReturnType<typeof useConversationSearchStatus>);
    const { container } = render(<ConversationSearchBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the unavailable reason when no API key is configured', () => {
    mockUseStatus.mockReturnValue({
      data: makeStatus({ available: false, unavailableReason: 'OpenAI API key not found. Add it under Settings → API Keys.' }),
    } as ReturnType<typeof useConversationSearchStatus>);
    render(<ConversationSearchBanner />);
    expect(screen.getByText(/OpenAI API key not found/)).toBeInTheDocument();
  });

  it('links to OpenAI billing when the failure is credit-related (PAN-3771)', () => {
    mockUseStatus.mockReturnValue({
      data: makeStatus({
        available: true,
        health: {
          lastErrorAt: '2026-08-24T12:00:00.000Z',
          lastErrorReason: 'You have no credits remaining.',
          lastSuccessAt: '2026-08-24T02:20:00.000Z',
        },
      }),
    } as ReturnType<typeof useConversationSearchStatus>);
    render(<ConversationSearchBanner />);
    const link = screen.getByRole('link', { name: /openai billing/i });
    expect(link).toHaveAttribute('href', 'https://platform.openai.com/settings/organization/billing/');
  });

  it('stays hidden when a success is newer than the recorded failure', () => {
    mockUseStatus.mockReturnValue({
      data: makeStatus({
        available: true,
        health: {
          lastErrorAt: '2026-08-24T02:00:00.000Z',
          lastErrorReason: 'You have no credits remaining.',
          lastSuccessAt: '2026-08-24T12:00:00.000Z',
        },
      }),
    } as ReturnType<typeof useConversationSearchStatus>);
    const { container } = render(<ConversationSearchBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
