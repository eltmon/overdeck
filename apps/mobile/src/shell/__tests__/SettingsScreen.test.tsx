import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type LiveActivitySetting, type NotificationsSetting, SettingsScreen } from '../SettingsScreen';
import type { AccountRecord } from '../types';

const ACCOUNT: AccountRecord = { token: 't', deviceId: 'dev-1', label: 'My phone' };

function notificationsSetting(overrides: Partial<NotificationsSetting> = {}): NotificationsSetting {
  return {
    enabled: true,
    permission: 'granted',
    onChange: vi.fn(),
    prefs: { v: 1, pause: null, muted: [] },
    onPause: vi.fn(),
    onResume: vi.fn(),
    onToggleCategory: vi.fn(),
    unsynced: [],
    ...overrides,
  };
}

function renderSettings(notifications?: NotificationsSetting) {
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
    renderSettings(notificationsSetting({ onChange }));
    const toggle = screen.getByRole('switch', { name: /Notifications/ });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.textContent).toContain('On');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
    expect(screen.getByText(/end-to-end encrypted/)).toBeTruthy();
  });

  it('says how to turn notifications on in iOS Settings when permission is denied', () => {
    renderSettings(notificationsSetting({ permission: 'denied' }));
    expect(
      screen.getByText('Notifications are off for Overdeck in iOS Settings. Open Settings → Notifications → Overdeck to turn them on.'),
    ).toBeTruthy();
  });
});

describe('SettingsScreen notification prefs (PAN-5019 WI-9)', () => {
  it('renders six category switches with the exact labels, and toggling one off calls onToggleCategory', () => {
    const onToggleCategory = vi.fn();
    renderSettings(notificationsSetting({ onToggleCategory }));
    for (const label of ['Agent questions', 'Plan approvals', 'Permission prompts', 'Finished work', 'Failures', 'Agent stopped responding']) {
      const toggle = screen.getByRole('switch', { name: label });
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    }
    fireEvent.click(screen.getByRole('switch', { name: 'Agent stopped responding' }));
    expect(onToggleCategory).toHaveBeenCalledWith('stopped', false);
  });

  it('shows a muted category as off', () => {
    renderSettings(notificationsSetting({ prefs: { v: 1, pause: null, muted: ['failed'] } }));
    expect(screen.getByRole('switch', { name: 'Failures' }).getAttribute('aria-checked')).toBe('false');
  });

  it("calls onPause('hour') from the 1-hour button and onPause('indefinite') from the Pause switch", () => {
    const onPause = vi.fn();
    renderSettings(notificationsSetting({ onPause }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause for 1 hour' }));
    expect(onPause).toHaveBeenCalledWith('hour');
    fireEvent.click(screen.getByRole('switch', { name: /Pause notifications/ }));
    expect(onPause).toHaveBeenCalledWith('indefinite');
  });

  it('calls onResume when the Pause switch is turned off while paused', () => {
    const onResume = vi.fn();
    renderSettings(notificationsSetting({ onResume, prefs: { v: 1, pause: { until: null }, muted: [] } }));
    fireEvent.click(screen.getByRole('switch', { name: /Pause notifications/ }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('renders Paused until text and hides the pause buttons when paused until a future instant', () => {
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    renderSettings(notificationsSetting({ prefs: { v: 1, pause: { until }, muted: [] } }));
    expect(screen.getByText(/^Paused until/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause for 1 hour' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause until tomorrow 8:00' })).toBeNull();
  });

  it('renders the indefinite-pause text when until is null', () => {
    renderSettings(notificationsSetting({ prefs: { v: 1, pause: { until: null }, muted: [] } }));
    expect(screen.getByText('Paused until you turn it back on')).toBeTruthy();
  });

  it('renders the help line', () => {
    renderSettings(notificationsSetting());
    expect(
      screen.getByText("Pause and notification types apply on each paired machine. The Notifications switch above turns this phone's registration with overdeck.ai off."),
    ).toBeTruthy();
  });

  it('renders the update line for an outdated machine', () => {
    renderSettings(notificationsSetting({ unsynced: [{ label: 'z790', status: 'outdated' }] }));
    expect(screen.getByText('Update Overdeck on z790 to apply these settings.')).toBeTruthy();
  });

  it('renders the not-yet-sent line for a pending or failed machine', () => {
    renderSettings(notificationsSetting({ unsynced: [{ label: 'desk', status: 'pending' }, { label: 'laptop', status: 'failed' }] }));
    expect(screen.getByText('Not yet sent to desk.')).toBeTruthy();
    expect(screen.getByText('Not yet sent to laptop.')).toBeTruthy();
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
