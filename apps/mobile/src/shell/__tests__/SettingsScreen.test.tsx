import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type LiveActivitySetting, SettingsScreen } from '../SettingsScreen';

const ACCOUNT = { token: 'odd_token', deviceId: 'dev-1', label: 'iPhone' };
const COPY = 'Shows how many items need you and how many agents are running on the lock screen. Apple and overdeck.ai see these two numbers.';
const HINT = 'Turn on Live Activities for Overdeck in iOS Settings.';

function renderSettings(liveActivity: LiveActivitySetting | null) {
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

afterEach(() => {
  cleanup();
});

describe('Settings Live Activity row (PAN-4839 WI-10)', () => {
  it('renders the switch and the privacy line on iOS when allowed', () => {
    renderSettings(setting());
    const toggle = screen.getByRole('switch', { name: 'Live Activity' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(COPY)).toBeTruthy();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('turns the card off and on through onChange', () => {
    const on = setting({ enabled: true });
    renderSettings(on);
    fireEvent.click(screen.getByRole('switch', { name: 'Live Activity' }));
    expect(on.onChange).toHaveBeenCalledWith(false);
    cleanup();
    const off = setting({ enabled: false });
    renderSettings(off);
    const toggle = screen.getByRole('switch', { name: 'Live Activity' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(off.onChange).toHaveBeenCalledWith(true);
  });

  it('shows the iOS Settings hint instead of the switch when iOS does not allow Live Activities', () => {
    renderSettings(setting({ allowed: false }));
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it('renders nothing on Android or on iOS before 16.2', () => {
    renderSettings(null);
    expect(screen.queryByText('Live Activity')).toBeNull();
    cleanup();
    renderSettings(setting({ available: false }));
    expect(screen.queryByText('Live Activity')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
