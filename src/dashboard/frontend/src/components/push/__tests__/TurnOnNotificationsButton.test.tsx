import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TurnOnNotificationsButton } from '../TurnOnNotificationsButton';
import { savePushSubscription, type PushStatus } from '../pushApi';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../pushApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pushApi')>();
  return {
    ...actual,
    loadPushStatus: vi.fn(async () => currentStatus),
    loadVapidPublicKey: vi.fn(async () => 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    savePushSubscription: vi.fn(async () => ({ id: 'sub-1' })),
  };
});

let currentStatus: PushStatus;

function status(subscriptions: PushStatus['webpush']['subscriptions'] = []): PushStatus {
  return {
    enabled: true,
    events: ['question', 'approval', 'finished', 'failed'],
    includePreview: false,
    webpush: { subscriptions },
    ntfy: { state: 'off' },
    native: { phones: 0, directoryOnline: false },
    stats: { sent: 0, dropped: 0, rateLimited: 0, lastError: null },
  };
}

const SUB_JSON = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } };

function renderButton() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TurnOnNotificationsButton />
    </QueryClientProvider>,
  );
}

describe('TurnOnNotificationsButton (PAN-2354)', () => {
  let register: ReturnType<typeof vi.fn>;
  let subscribe: ReturnType<typeof vi.fn>;
  let secure: boolean;

  beforeEach(() => {
    currentStatus = status();
    secure = true;
    subscribe = vi.fn(async () => ({ toJSON: () => SUB_JSON }));
    const registration = { pushManager: { getSubscription: vi.fn(async () => null), subscribe } };
    register = vi.fn(async () => registration);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register, ready: Promise.resolve(registration) },
    });
    vi.stubGlobal('PushManager', function PushManager() {});
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(async () => 'granted') });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => secure });
    vi.mocked(savePushSubscription).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('explains the HTTPS requirement in an insecure context', () => {
    secure = false;
    renderButton();
    expect(screen.getByText(/Open this dashboard over HTTPS/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).toBeNull();
  });

  it('registers /sw.js at scope / and saves the subscription on click', async () => {
    renderButton();
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on notifications' }));
    await waitFor(() => expect(savePushSubscription).toHaveBeenCalledTimes(1));
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(savePushSubscription).toHaveBeenCalledWith(SUB_JSON, 'This browser');
  });

  it('shows Notifications on when this device is subscribed', async () => {
    currentStatus = status([{ id: 's1', label: 'Android', host: 'fcm.googleapis.com', createdAt: '2026-11-01T00:00:00.000Z', lastSuccessAt: null, failureCount: 0, thisDevice: true }]);
    renderButton();
    expect(await screen.findByText('Notifications on')).toBeTruthy();
  });
});
