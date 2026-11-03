import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DialogProvider } from '../../../DialogProvider';
import { PushPanel } from '../PushPanel';
import { toast } from 'sonner';
import { deletePushSubscription, sendTestPush, type PushStatus } from '../../../push/pushApi';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../push/TurnOnNotificationsButton', () => ({ TurnOnNotificationsButton: () => null }));
vi.mock('../../../push/pushApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../push/pushApi')>();
  return {
    ...actual,
    loadPushStatus: vi.fn(async () => currentStatus),
    deletePushSubscription: vi.fn(async () => undefined),
    sendTestPush: vi.fn(async () => [{ target: 'webpush:s1', ok: true }]),
  };
});

const FULL_TOPIC = 'deck-k3J9xQ2mV7pL4sTa';
let currentStatus: PushStatus;

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider><PushPanel /></DialogProvider>
    </QueryClientProvider>,
  );
}

describe('PushPanel (PAN-2354)', () => {
  beforeEach(() => {
    currentStatus = {
      enabled: true,
      events: ['question', 'approval', 'finished', 'failed'],
      includePreview: false,
      webpush: {
        subscriptions: [{ id: 's1', label: 'Android', host: 'fcm.googleapis.com', createdAt: '2026-11-01T00:00:00.000Z', lastSuccessAt: null, failureCount: 2, thisDevice: false }],
      },
      ntfy: { state: 'ready', host: 'ntfy.example.net', topicHint: 'deck…' },
      native: { phones: 0, directoryOnline: false },
      stats: { sent: 0, dropped: 0, rateLimited: 0, lastError: null },
    };
    vi.mocked(deletePushSubscription).mockClear();
  });

  it('removes a device after confirmation', async () => {
    renderPanel();
    const row = (await screen.findByText('Android')).closest('li') as HTMLElement;
    expect(within(row).getByText(/fcm\.googleapis\.com/)).toBeTruthy();
    expect(within(row).getByText(/2 failed/)).toBeTruthy();
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove Android?')).toBeTruthy();
    expect(deletePushSubscription).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(deletePushSubscription).toHaveBeenCalledWith('s1'));
  });

  it('renders the ntfy topic hint and never the full topic', async () => {
    renderPanel();
    expect(await screen.findByText('ntfy: ntfy.example.net · topic deck…')).toBeTruthy();
    expect(document.body.textContent).not.toContain(FULL_TOPIC);
  });

  it.each<[PushStatus['native'], string]>([
    [{ phones: 0, directoryOnline: false }, 'Overdeck app: no phones paired.'],
    [{ phones: 1, directoryOnline: true }, 'Overdeck app: 1 phone'],
    [{ phones: 3, directoryOnline: false }, 'Overdeck app: 3 phones · not connected to overdeck.ai, so no notifications reach them'],
  ])('renders the Overdeck app line for %o (PAN-4843)', async (native, text) => {
    currentStatus = { ...currentStatus, native };
    renderPanel();
    expect((await screen.findByTestId('push-native-line')).textContent).toBe(text);
  });

  it('does not report a skipped phone as a failed test (PAN-4843)', async () => {
    vi.mocked(sendTestPush).mockResolvedValueOnce([
      { target: 'webpush:s1', ok: true },
      { target: 'native:c1', ok: false, reason: 'skipped', detail: 'no_registration' },
    ]);
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Send test' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Test sent to 1 target(s)'));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
