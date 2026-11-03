import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsScreen } from '../SettingsScreen';
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
