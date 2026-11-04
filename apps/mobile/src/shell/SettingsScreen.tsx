/** Settings (PAN-4837 C-8): the account, notifications (PAN-4838 FR-4), paired machines, the Live Activity switch (PAN-4839), the app version and sign out. */
import { useState } from 'react';

import type { PushPermission } from '../native/push';
import { APP_VERSION } from './config';
import type { AccountRecord, PairedMachine } from './types';

/** The Live Activity row (PAN-4839); null on Android. */
export interface LiveActivitySetting {
  /** iOS 16.2 or later. */
  available: boolean;
  /** iOS Settings allows Live Activities for Overdeck. */
  allowed: boolean;
  /** The app's switch. */
  enabled: boolean;
  onChange(on: boolean): void;
}

interface SettingsScreenProps {
  account: AccountRecord;
  machines: readonly PairedMachine[];
  /** The Live Activity row (PAN-4839); absent or null where it is not supported. */
  liveActivity?: LiveActivitySetting | null;
  onForget(environmentId: string): void;
  onSignOut(): Promise<void>;
  onBack(): void;
  /** The Notifications switch; absent where push is not supported. */
  notifications?: { enabled: boolean; permission: PushPermission; onChange(on: boolean): void };
}

export function SettingsScreen({ account, machines, liveActivity, onForget, onSignOut, onBack, notifications }: SettingsScreenProps) {
  const [signingOut, setSigningOut] = useState(false);

  return (
    <section
      data-component="settings-screen"
      className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-[env(safe-area-inset-bottom)] pt-[calc(env(safe-area-inset-top)+1rem)]"
    >
      <button type="button" onClick={onBack} className="min-h-11 self-start text-sm text-foreground">
        ‹ Machines
      </button>
      <h2 className="text-base font-medium text-foreground">Settings</h2>
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Signed in to overdeck.ai</span>
        <span className="text-foreground">{account.label || 'This phone'}</span>
        <span className="font-mono text-xs text-muted-foreground">{account.deviceId}</span>
      </div>
      {notifications ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">Notifications</h3>
          <button
            type="button"
            role="switch"
            aria-checked={notifications.enabled}
            onClick={() => notifications.onChange(!notifications.enabled)}
            className="flex min-h-11 items-center justify-between gap-3 border-b border-border text-sm text-foreground"
          >
            <span>Notifications</span>
            <span className="text-muted-foreground">{notifications.enabled ? 'On' : 'Off'}</span>
          </button>
          <p className="text-xs text-muted-foreground">
            {notifications.permission === 'denied'
              ? 'Notifications are off for Overdeck in iOS Settings. Open Settings → Notifications → Overdeck to turn them on.'
              : 'Needs-you alerts from your paired machines. Their text is end-to-end encrypted; only this phone can read it.'}
          </p>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">Paired machines</h3>
        {machines.length === 0 ? <p className="text-sm text-muted-foreground">No paired machines.</p> : null}
        <ul className="flex flex-col">
          {machines.map((machine) => (
            <li key={machine.environmentId} className="flex min-h-11 items-center justify-between gap-3 border-b border-border">
              <span className="truncate text-sm text-foreground">{machine.label}</span>
              <button type="button" onClick={() => onForget(machine.environmentId)} className="min-h-11 px-2 text-sm text-foreground">
                Forget
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Forget removes a machine from this phone only. Remove the phone on the machine in Settings → Anywhere.
        </p>
      </div>
      {liveActivity?.available ? <LiveActivityRow setting={liveActivity} /> : null}
      <p className="text-xs text-muted-foreground">Overdeck {APP_VERSION}</p>
      <button
        type="button"
        disabled={signingOut}
        onClick={() => {
          setSigningOut(true);
          void onSignOut().finally(() => setSigningOut(false));
        }}
        className="min-h-11 w-full rounded-sm border border-border px-3 text-sm font-medium text-destructive disabled:opacity-50"
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </section>
  );
}

function LiveActivityRow({ setting }: { setting: LiveActivitySetting }) {
  return (
    <div data-component="live-activity-setting" className="flex flex-col gap-2">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h3 id="live-activity-label" className="text-sm font-medium text-foreground">
          Live Activity
        </h3>
        {setting.allowed ? (
          <button
            type="button"
            role="switch"
            aria-checked={setting.enabled}
            aria-labelledby="live-activity-label"
            onClick={() => setting.onChange(!setting.enabled)}
            className="min-h-11 min-w-14 rounded-sm border border-border px-2 text-sm text-foreground"
          >
            {setting.enabled ? 'On' : 'Off'}
          </button>
        ) : null}
      </div>
      {setting.allowed ? (
        <p className="text-xs text-muted-foreground">
          Shows how many items need you and how many agents are running on the lock screen. Apple and overdeck.ai see these two numbers.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Turn on Live Activities for Overdeck in iOS Settings.</p>
      )}
    </div>
  );
}
