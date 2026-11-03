/** Settings (PAN-4837 C-8): the account, paired machines, the app version and sign out. */
import { useState } from 'react';

import { APP_VERSION } from './config';
import type { AccountRecord, PairedMachine } from './types';

interface SettingsScreenProps {
  account: AccountRecord;
  machines: readonly PairedMachine[];
  onForget(environmentId: string): void;
  onSignOut(): Promise<void>;
  onBack(): void;
}

export function SettingsScreen({ account, machines, onForget, onSignOut, onBack }: SettingsScreenProps) {
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
