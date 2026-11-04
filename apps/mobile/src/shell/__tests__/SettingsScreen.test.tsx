import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type LiveActivitySetting, SettingsScreen } from '../SettingsScreen';
import type { AccountRecord } from '../types';

const ACCOUNT: AccountRecord = { token: 't', deviceId: 'dev-1', label: 'My phone' };

function renderSettings(notifications?: Parameters<typeof SettingsScreen>[0]['notifications']) {
  return render(
    <SettingsScreen
      account={ACCOUNT}
      machines={[]}
      onForget={() => {}}
      onSignOut={async () => {}}
      onBack={() => {}}
      notifications={notifications}
    />,
  );
}

afterEach(() => cleanup());

describe('SettingsScreen notifications (PAN-4838 WI-9)', () => {
  it('renders no switch without notifications', () => {
    renderSettings();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('shows the switch on and turns it off', () => {
    const onChange = vi.fn();
    renderSettings({ enabled: true, permission: 'granted', onChange });
    const toggle = screen.getByRole('switch', { name: /Notifications/ });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.textContent).toContain('On');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
    expect(screen.getByText(/end-to-end encrypted/)).toBeTruthy();
  });

  it('says how to turn notifications on in iOS Settings when permission is denied', () => {
    renderSettings({ enabled: true, permission: 'denied', onChange: () => {} });
    expect(
      screen.getByText('Notifications are off for Overdeck in iOS Settings. Open Settings → Notifications → Overdeck to turn them on.'),
    ).toBeTruthy();
  });
});

const LIVE_ACTIVITY_COPY = 'Shows how many items need you and how many agents are running on the lock screen. Apple and overdeck.ai see these two numbers.';
const HINT = 'Turn on Live Activities for Overdeck in iOS Settings.';

function renderWithLiveActivity(liveActivity: LiveActivitySetting | null) {
  return render(
    <SettingsScreen
      account={ACCOUNT}
      machines={[]}
      liveActivity={liveActivity}
      onForget={() => undefined}
      onSignOut={async () => undefined}
      onBack={() => undefined}
    />,
  );
}

const setting = (over: Partial<LiveActivitySetting> = {}): LiveActivitySetting => ({
  available: true,
  allowed: true,
  enabled: true,
  onChange: vi.fn(),
  ...over,
});

describe('Settings Live Activity row (PAN-4839 WI-10)', () => {
  it('renders the switch and the privacy line on iOS when allowed', () => {
    renderWithLiveActivity(setting());
    const toggle = screen.getByRole('switch', { name: 'Live Activity' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(LIVE_ACTIVITY_COPY)).toBeTruthy();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('turns the card off and on through onChange', () => {
    const on = setting({ enabled: true });
    renderWithLiveActivity(on);
    fireEvent.click(screen.getByRole('switch', { name: 'Live Activity' }));
    expect(on.onChange).toHaveBeenCalledWith(false);
    cleanup();
    const off = setting({ enabled: false });
    renderWithLiveActivity(off);
    const toggle = screen.getByRole('switch', { name: 'Live Activity' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(off.onChange).toHaveBeenCalledWith(true);
  });

  it('shows the iOS Settings hint instead of the switch when iOS does not allow Live Activities', () => {
    renderWithLiveActivity(setting({ allowed: false }));
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it('renders nothing on Android or on iOS before 16.2', () => {
    renderWithLiveActivity(null);
    expect(screen.queryByText('Live Activity')).toBeNull();
    cleanup();
    renderWithLiveActivity(setting({ available: false }));
    expect(screen.queryByText('Live Activity')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
