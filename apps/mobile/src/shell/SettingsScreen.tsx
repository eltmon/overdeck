/** Settings (PAN-4837 C-8): the account, notifications (PAN-4838 FR-4, PAN-5019 WI-9), paired machines, the Live Activity switch (PAN-4839), the app version and sign out. */
import { PHONE_NOTIFICATION_CATEGORIES, type PhoneNotificationCategory, type PhoneNotificationPreferences } from '@overdeck/contracts';
import { useState } from 'react';

import type { PushPermission } from '../native/push';
import { APPEARANCES, type Appearance } from './appearance';
import { APP_VERSION } from './config';
import { isPaused, type PauseChoice } from './notificationPrefs';
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

/** The Notifications switch plus pause and notification-type controls (PAN-5019 WI-9). */
export interface NotificationsSetting {
  enabled: boolean;
  permission: PushPermission;
  onChange(on: boolean): void;
  prefs: PhoneNotificationPreferences;
  onPause(choice: PauseChoice): void;
  onResume(): void;
  onToggleCategory(category: PhoneNotificationCategory, on: boolean): void;
  /** Machines that have not received the current prefs: label plus status. */
  unsynced: ReadonlyArray<{ label: string; status: 'pending' | 'outdated' | 'failed' }>;
}

interface SettingsScreenProps {
  account: AccountRecord;
  machines: readonly PairedMachine[];
  /** The Live Activity row (PAN-4839); absent or null where it is not supported. */
  liveActivity?: LiveActivitySetting | null;
  onForget(environmentId: string): void;
  onSignOut(): Promise<void>;
  onBack(): void;
  /** The Notifications switch and pause/type controls; absent where push is not supported. */
  notifications?: NotificationsSetting;
  /** The phone's System/Light/Dark appearance setting (PAN-5041). */
  appearance: Appearance;
  onAppearanceChange(appearance: Appearance): void;
}

const APPEARANCE_LABEL: Record<Appearance, string> = { system: 'System', light: 'Light', dark: 'Dark' };

function AppearanceSection({ value, onChange }: { value: Appearance; onChange(appearance: Appearance): void }) {
  return (
    <div data-component="appearance-setting" className="flex flex-col gap-2">
      <h3 id="appearance-label" className="text-sm font-medium text-foreground">
        Appearance
      </h3>
      <div role="radiogroup" aria-labelledby="appearance-label" className="flex flex-col">
        {APPEARANCES.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={value === a}
            onClick={() => onChange(a)}
            className="flex min-h-11 items-center justify-between gap-3 border-b border-border text-sm text-foreground"
          >
            <span>{APPEARANCE_LABEL[a]}</span>
            <span className="text-muted-foreground">{value === a ? '✓' : ''}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{"System follows this phone's light or dark setting. Stored on this phone only."}</p>
    </div>
  );
}

const CATEGORY_LABEL: Record<PhoneNotificationCategory, string> = {
  question: 'Agent questions',
  plan: 'Plan approvals',
  permission: 'Permission prompts',
  finished: 'Finished work',
  failed: 'Failures',
  stopped: 'Agent stopped responding',
};

export function SettingsScreen({
  account,
  machines,
  liveActivity,
  onForget,
  onSignOut,
  onBack,
  notifications,
  appearance,
  onAppearanceChange,
}: SettingsScreenProps) {
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
      <AppearanceSection value={appearance} onChange={onAppearanceChange} />
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
          <NotificationPrefsSection notifications={notifications} />
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

function NotificationPrefsSection({ notifications }: { notifications: NotificationsSetting }) {
  const paused = isPaused(notifications.prefs, Date.now());
  const until = notifications.prefs.pause?.until ?? null;
  return (
    <div data-component="notification-prefs" className="flex flex-col gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={paused}
        aria-label="Pause notifications"
        onClick={() => (paused ? notifications.onResume() : notifications.onPause('indefinite'))}
        className="flex min-h-11 items-center justify-between gap-3 border-b border-border text-sm text-foreground"
      >
        <span>Pause notifications</span>
        <span className="text-muted-foreground">{paused ? 'On' : 'Off'}</span>
      </button>
      {paused ? (
        <p className="text-xs text-muted-foreground">
          {until === null
            ? 'Paused until you turn it back on'
            : `Paused until ${new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
        </p>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => notifications.onPause('hour')}
            className="min-h-11 flex-1 rounded-sm border border-border text-sm text-foreground"
          >
            Pause for 1 hour
          </button>
          <button
            type="button"
            onClick={() => notifications.onPause('morning')}
            className="min-h-11 flex-1 rounded-sm border border-border text-sm text-foreground"
          >
            Pause until tomorrow 8:00
          </button>
        </div>
      )}
      <h4 className="text-sm font-medium text-foreground">Notification types</h4>
      <ul className="flex flex-col">
        {PHONE_NOTIFICATION_CATEGORIES.map((category) => {
          const on = !notifications.prefs.muted.includes(category);
          return (
            <li key={category} className="border-b border-border">
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={CATEGORY_LABEL[category]}
                onClick={() => notifications.onToggleCategory(category, !on)}
                className="flex min-h-11 w-full items-center justify-between gap-3 text-sm text-foreground"
              >
                <span>{CATEGORY_LABEL[category]}</span>
                <span className="text-muted-foreground">{on ? 'On' : 'Off'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        {"Pause and notification types apply on each paired machine. The Notifications switch above turns this phone's registration with overdeck.ai off."}
      </p>
      {notifications.unsynced.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {notifications.unsynced.map((machine) => (
            <li key={machine.label} className="text-xs text-muted-foreground">
              {machine.status === 'outdated' ? `Update Overdeck on ${machine.label} to apply these settings.` : `Not yet sent to ${machine.label}.`}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
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
