/** The phone app's root: identity, the account, URL opens, and which shell screen shows (PAN-4837). */
import { App } from '@capacitor/app';
import { useCallback, useEffect, useState } from 'react';

import { type DeviceIdentity, loadIdentity } from '../native/keys';
import { createDirectory, type ShellDirectory } from './directory';
import { MachinesScreen } from './MachinesScreen';
import { shellPlatform } from './platform';
import { SignInScreen } from './SignInScreen';
import { completeSignIn, isSignInCallback, startSignIn } from './signIn';
import { readAccount, readMachines, useShellStore } from './store';

type Boot = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; identity: DeviceIdentity };
/** Shell screens shown while signed in and no machine view is open. */
type View = { kind: 'machines' } | { kind: 'pair'; environmentId: string | null } | { kind: 'settings' };

export default function ShellApp() {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const [signInError, setSignInError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'machines' });
  const [directory, setDirectory] = useState<ShellDirectory | null>(null);
  const account = useShellStore((s) => s.account);
  const paired = useShellStore((s) => s.machines);
  const setAccount = useShellStore((s) => s.setAccount);
  const setMachines = useShellStore((s) => s.setMachines);

  const handleUrl = useCallback(
    async (url: string) => {
      if (!isSignInCallback(url)) return;
      try {
        setAccount(await completeSignIn(url));
        setSignInError(null);
      } catch (e) {
        setSignInError(e instanceof Error ? e.message : String(e));
      }
    },
    [setAccount],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const identity = await loadIdentity();
        const [storedAccount, machines] = await Promise.all([readAccount(), readMachines()]);
        if (cancelled) return;
        setAccount(storedAccount);
        setMachines(machines);
        setBoot({ kind: 'ready', identity });
        const launch = await App.getLaunchUrl();
        if (!cancelled && launch?.url) await handleUrl(launch.url);
      } catch (e) {
        if (!cancelled) setBoot({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    const listener = App.addListener('appUrlOpen', ({ url }) => void handleUrl(url));
    return () => {
      cancelled = true;
      void listener.then((handle) => handle.remove());
    };
  }, [handleUrl, setAccount, setMachines]);

  const identity = boot.kind === 'ready' ? boot.identity : null;
  useEffect(() => {
    if (!identity || !account) return;
    const created = createDirectory({
      identity,
      accountToken: async () => (await readAccount())?.token ?? null,
      label: account.label,
      platform: shellPlatform(),
    });
    setDirectory(created);
    void created.client.start();
    return () => {
      created.client.stop();
      created.dialer.close();
      setDirectory(null);
    };
  }, [identity, account]);

  return (
    <div data-component="mobile-shell" className="fixed inset-0 flex flex-col bg-background text-foreground">
      {boot.kind === 'loading' ? null : boot.kind === 'failed' ? (
        <p role="alert" className="px-4 pt-[calc(env(safe-area-inset-top)+2rem)] text-sm text-destructive">
          {boot.message}
        </p>
      ) : account === null ? (
        <SignInScreen error={signInError} onSignIn={() => startSignIn(boot.identity, shellPlatform())} />
      ) : directory === null ? null : view.kind === 'machines' ? (
        <MachinesScreen
          client={directory.client}
          paired={paired}
          onPair={(machine) => setView({ kind: 'pair', environmentId: machine?.environmentId ?? null })}
          onSettings={() => setView({ kind: 'settings' })}
          onSignedOut={() => setAccount(null)}
        />
      ) : (
        <section className="flex flex-1 flex-col gap-3 px-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
          <button type="button" onClick={() => setView({ kind: 'machines' })} className="min-h-11 self-start text-sm text-foreground">
            ‹ Machines
          </button>
          <p className="text-sm text-muted-foreground">{view.kind === 'pair' ? 'Pairing' : 'Settings'} comes in a later build.</p>
        </section>
      )}
    </div>
  );
}
