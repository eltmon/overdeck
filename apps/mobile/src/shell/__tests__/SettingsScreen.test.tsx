import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PushState } from '../../native/push';
import { SettingsScreen } from '../SettingsScreen';

const ACCOUNT = { token: 'odd_x', deviceId: 'dev-1', label: 'Pixel' };

function renderWith(notifications: PushState | null, onTurnOnNotifications = vi.fn()) {
  render(
    <SettingsScreen
      account={ACCOUNT}
      machines={[]}
      notifications={notifications}
      onTurnOnNotifications={onTurnOnNotifications}
      onForget={() => undefined}
      onSignOut={async () => undefined}
      onBack={() => undefined}
    />,
  );
  return onTurnOnNotifications;
}

const block = () => document.querySelector('[data-component="settings-notifications"]');

afterEach(() => {
  cleanup();
});

describe('SettingsScreen notifications row', () => {
  it('shows On', () => {
    renderWith('on');
    expect(block()?.textContent).toBe('NotificationsOn');
  });

  it('tells the operator where to turn them on when denied', () => {
    renderWith('off');
    expect(screen.getByText('Off. Turn them on in Android Settings → Apps → Overdeck → Notifications.')).toBeTruthy();
  });

  it('says the build has no push set up', () => {
    renderWith('unavailable');
    expect(screen.getByText('Not set up in this build.')).toBeTruthy();
  });

  it('offers Turn on when never asked, and calls the handler once', () => {
    const onTurnOn = renderWith('prompt');
    screen.getByText('Turn on').click();
    expect(onTurnOn).toHaveBeenCalledTimes(1);
  });

  it('renders nothing until the state is known', () => {
    renderWith(null);
    expect(block()).toBeNull();
  });
});
