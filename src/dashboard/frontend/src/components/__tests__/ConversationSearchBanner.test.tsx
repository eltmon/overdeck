import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ConversationSearchBanner } from '../ConversationSearchBanner';
import { useConversationSearchStatus, type ConversationSearchStatus } from '../../hooks/useConversationSearchStatus';
import { requestSettingsSection } from '../../lib/settingsSection';

vi.mock('../../hooks/useConversationSearchStatus', () => ({
  useConversationSearchStatus: vi.fn(),
}));
vi.mock('../../lib/settingsSection', () => ({
  requestSettingsSection: vi.fn(),
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

  it('offers a one-click route to the OpenAI key field when no API key is configured', () => {
    mockUseStatus.mockReturnValue({
      data: makeStatus({ available: false, unavailableReason: 'OpenAI API key not found. Add it under Settings → Providers → OpenAI.' }),
    } as ReturnType<typeof useConversationSearchStatus>);
    const onOpenSettings = vi.fn();
    render(<ConversationSearchBanner onOpenSettings={onOpenSettings} />);
    expect(screen.getByText('Conversation search needs an OpenAI API key')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add openai key/i }));
    expect(requestSettingsSection).toHaveBeenCalledWith('provider-openai');
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('shows the raw reason for other unavailability causes', () => {
    mockUseStatus.mockReturnValue({
      data: makeStatus({ available: false, unavailableReason: 'embedding provider misconfigured' }),
    } as ReturnType<typeof useConversationSearchStatus>);
    render(<ConversationSearchBanner />);
    expect(screen.getByText('Conversation search is not working')).toBeInTheDocument();
    expect(screen.getByText('embedding provider misconfigured')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add openai key/i })).not.toBeInTheDocument();
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

  it('shows a watcher that is waiting to restart (PAN-3915)', () => {
    mockUseStatus.mockReturnValue({
      data: makeStatus({
        health: {
          lastErrorAt: null,
          lastErrorReason: null,
          lastSuccessAt: '2026-09-24T12:00:00.000Z',
          watcher: {
            state: 'restarting',
            restarts: 0,
            lastErrorAt: '2026-09-24T12:05:00.000Z',
            lastErrorReason: 'Unable to poll: Interrupted system call',
            nextRestartAt: '2026-09-24T12:05:01.000Z',
          },
        },
      }),
    } as ReturnType<typeof useConversationSearchStatus>);
    render(<ConversationSearchBanner />);
    expect(screen.getByText(/transcript watcher failed \(Unable to poll: Interrupted system call\), restarting/)).toBeInTheDocument();
    expect(screen.getByText(/new transcripts are not indexed/)).toBeInTheDocument();
  });

  it('keeps showing a watcher whose restarts stopped, naming the error (PAN-3915)', () => {
    mockUseStatus.mockReturnValue({
      data: makeStatus({
        health: {
          lastErrorAt: null,
          lastErrorReason: null,
          lastSuccessAt: '2026-09-24T12:06:00.000Z',
          watcher: {
            state: 'failed',
            restarts: 5,
            lastErrorAt: '2026-09-24T12:05:00.000Z',
            lastErrorReason: 'ENOSPC: System limit for number of file watchers reached (inotify watch limit reached; raise fs.inotify.max_user_watches)',
            nextRestartAt: null,
          },
        },
      }),
    } as ReturnType<typeof useConversationSearchStatus>);
    render(<ConversationSearchBanner />);
    expect(screen.getByText(/transcript watcher stopped after repeated failures \(ENOSPC: System limit for number of file watchers reached/)).toBeInTheDocument();
    expect(screen.getByText(/fs\.inotify\.max_user_watches/)).toBeInTheDocument();
    expect(screen.getByText(/Restart the dashboard or save the conversation-search settings to retry/)).toBeInTheDocument();
    expect(screen.queryByText(/restarting/)).not.toBeInTheDocument();
  });

  it('stays hidden once a failed watcher has been restarted (PAN-3915)', () => {
    mockUseStatus.mockReturnValue({
      data: makeStatus({
        health: {
          lastErrorAt: null,
          lastErrorReason: null,
          lastSuccessAt: '2026-09-24T12:06:00.000Z',
          watcher: {
            state: 'running',
            restarts: 1,
            lastErrorAt: '2026-09-24T12:05:00.000Z',
            lastErrorReason: 'Unable to poll: Interrupted system call',
            nextRestartAt: null,
          },
        },
      }),
    } as ReturnType<typeof useConversationSearchStatus>);
    const { container } = render(<ConversationSearchBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
