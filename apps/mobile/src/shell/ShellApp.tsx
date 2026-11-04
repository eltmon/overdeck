/** The phone app's root: identity, the account, URL opens, and which shell screen shows (PAN-4837). */
import { App } from '@capacitor/app';
import { PHONE_PAIR_LINK_PREFIX, parsePhonePairLink, type PhoneNotificationCategory } from '@overdeck/contracts';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { type DeviceIdentity, loadIdentity } from '../native/keys';
import { type LiveActivityStatus, OverdeckLiveActivity } from '../native/liveActivity';
import { type PushController, pushSupported, startPush, unregisterPush, usePushState } from '../native/push';
import { type Connection, createConnection } from './connection';
import { createDirectory, type ShellDirectory } from './directory';
import { resetTransport } from '../../../../src/dashboard/frontend/src/lib/wsTransport';
import { installResumeHandler } from './lifecycle';
import { createLiveActivityController, type LiveActivityController, liveActivityEnabled, setLiveActivityEnabled } from './liveActivity';
import { MachinesScreen } from './MachinesScreen';
import { MachineView } from './MachineView';
import { NOTIFICATION_LINK_PREFIX, type NotificationOpen, parseNotificationLink } from './notificationLink';
import { markSynced, pauseFor, readNotificationPrefs, useNotificationPrefs, writeNotificationPrefs, type PauseChoice } from './notificationPrefs';
import { createPrefsSync, type PrefsSync, putPrefsOver } from './notificationPrefsSync';
import { installNotificationTap } from './notificationTap';
import { PairScreen } from './PairScreen';
import { pairMachine } from './pairing';
import { shellPlatform } from './platform';
import { createRelayMeter } from './relayMeter';
import { RemovedScreen } from './RemovedScreen';
import { lastDialError, onSessionChange, setSession } from './session';
import { SettingsScreen } from './SettingsScreen';
import { SignInScreen } from './SignInScreen';
import { completeSignIn, isSignInCallback, startSignIn } from './signIn';
import { deleteAccountDevice, removeSelfOver, resetAllKeys, signOut } from './signOut';
import { currentMachineId, readAccount, readMachines, setCurrentMachineId, useShellStore, writeMachines } from './store';
import type { PairedMachine } from './types';

type Boot = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; identity: DeviceIdentity };
/** Shell screens shown while signed in and no machine view is open. */
type View = { kind: 'machines' } | { kind: 'pair'; link: string | null } | { kind: 'settings' };

interface Services {
  directory: ShellDirectory;
  connection: Connection;
  liveActivity: LiveActivityController;
  /** Push registration on iOS (PAN-4838) and Android (PAN-4840). */
  push: PushController | null;
  /** Notification-prefs sync to every paired machine (PAN-5019 WI-8), wherever push is supported. */
  prefsSync: PrefsSync | null;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * The launch URL already handled in this WebView. Switching machines reloads the page (C-7), and
 * on Android `App.getLaunchUrl()` keeps answering the activity's original launch intent, and on iOS
 * it answers with the last URL that opened the app, even one delivered by `appUrlOpen` while it ran.
 * Without this a pair link would reopen the pair screen with a used code after each reload. Session
 * storage survives a reload and is empty in a new app process.
 */
const LAUNCH_URL_KEY = 'overdeck.launchUrlHandled';

function takeLaunchUrl(url: string): boolean {
  try {
    if (sessionStorage.getItem(LAUNCH_URL_KEY) === url) return false;
    sessionStorage.setItem(LAUNCH_URL_KEY, url);
  } catch {
    // Storage unavailable: handle the URL.
  }
  return true;
}

interface ShellAppProps {
  /** Default `location.assign`: opening a machine reloads the page (C-7). */
  navigate?: (path: string) => void;
}

export default function ShellApp({ navigate = (path) => location.assign(path) }: ShellAppProps) {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const [signInError, setSignInError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'machines' });
  const [services, setServices] = useState<Services | null>(null);
  /** A pair link that arrived before sign-in; it opens the pair screen once signed in. */
  const [pendingPairLink, setPendingPairLink] = useState<string | null>(null);
  /** An Android notification tap (PAN-4840 FR-6); it opens its machine once signed in. */
  const [pendingOpen, setPendingOpen] = useState<NotificationOpen | null>(null);
  const account = useShellStore((s) => s.account);
  const paired = useShellStore((s) => s.machines);
  const setAccount = useShellStore((s) => s.setAccount);
  const setMachines = useShellStore((s) => s.setMachines);
  /** iOS only (PAN-4839): read once for the Settings row. */
  const [liveActivityStatus, setLiveActivityStatus] = useState<LiveActivityStatus | null>(null);
  const [liveActivityOn, setLiveActivityOn] = useState(liveActivityEnabled);

  const handleUrl = useCallback(
    async (url: string) => {
      // Callers pass a notification link only the first time this app process sees it. An
      // unparseable link matches no paired machine and shows the machine list.
      if (url.startsWith(NOTIFICATION_LINK_PREFIX)) {
        setPendingOpen(parseNotificationLink(url) ?? { environmentId: '', path: '' });
        return;
      }
      if (url.startsWith(PHONE_PAIR_LINK_PREFIX)) {
        setPendingPairLink(url);
        return;
      }
      if (!isSignInCallback(url)) return;
      try {
        setAccount(await completeSignIn(url));
        setSignInError(null);
      } catch (e) {
        setSignInError(errorText(e));
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
        if (!cancelled && launch?.url && takeLaunchUrl(launch.url)) await handleUrl(launch.url);
      } catch (e) {
        if (!cancelled) setBoot({ kind: 'failed', message: errorText(e) });
      }
    })();
    // Record a URL that arrives while running as handled too: iOS answers getLaunchUrl() with it
    // after the next reload, which would reopen the pair screen with a used code.
    const listener = App.addListener('appUrlOpen', ({ url }) => {
      // Each notification link is unique by its timestamp, so a repeat is a replay: skip it.
      if (!takeLaunchUrl(url) && url.startsWith(NOTIFICATION_LINK_PREFIX)) return;
      void handleUrl(url);
    });
    return () => {
      cancelled = true;
      void listener.then((handle) => handle.remove());
    };
  }, [handleUrl, setAccount, setMachines]);

  useEffect(() => {
    if (account === null || pendingPairLink === null) return;
    // Also leaves the machine view, which would otherwise keep rendering over the pair screen.
    setCurrentMachineId(null);
    if (location.pathname !== '/') history.replaceState(null, '', '/');
    setView({ kind: 'pair', link: pendingPairLink });
    setPendingPairLink(null);
  }, [account, pendingPairLink]);

  useEffect(() => {
    if (account === null || pendingOpen === null) return;
    setPendingOpen(null);
    if (paired.some((m) => m.environmentId === pendingOpen.environmentId)) {
      setCurrentMachineId(pendingOpen.environmentId);
      navigate(pendingOpen.path);
    } else {
      setCurrentMachineId(null);
      if (location.pathname !== '/') history.replaceState(null, '', '/');
      setView({ kind: 'machines' });
    }
  }, [account, pendingOpen, paired, navigate]);

  // After boot, so the plugin's retained cold-launch tap finds the paired machines in the store (FR-8).
  const booted = boot.kind === 'ready';
  // The default `navigate` is a new function each render; the listener reads the latest one.
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  useEffect(() => {
    // iOS only: Android notifications are posted by OverdeckMessagingService and arrive as an open link.
    if (!booted || !pushSupported() || shellPlatform() !== 'ios') return;
    return installNotificationTap({
      paired: () => useShellStore.getState().machines,
      signedIn: () => useShellStore.getState().account !== null,
      open: (target) => {
        if (target.kind === 'machine') {
          setCurrentMachineId(target.environmentId);
          navigateRef.current(target.path);
        } else {
          setCurrentMachineId(null);
          navigateRef.current('/');
        }
      },
    });
  }, [booted]);

  const identity = boot.kind === 'ready' ? boot.identity : null;
  useEffect(() => {
    if (!identity || !account) return;
    const directory = createDirectory({
      identity,
      accountToken: async () => (await readAccount())?.token ?? null,
      label: account.label,
      platform: shellPlatform(),
    });
    const meter = createRelayMeter((bytes) => directory.client.send({ type: 'relay-usage', bytes }));
    const connection = createConnection({ directory, meter });
    const platform = shellPlatform();
    const push = pushSupported() ? startPush({ directory: directory.client, platform }) : null;
    const prefsSync = pushSupported()
      ? createPrefsSync({
        directory: directory.client,
        paired: () => useShellStore.getState().machines,
        send: putPrefsOver(connection),
      })
      : null;
    const liveActivity = createLiveActivityController({ plugin: OverdeckLiveActivity, directory: directory.client, platform });
    setServices({ directory, connection, push, liveActivity, prefsSync });
    void directory.client.start();
    void liveActivity.refresh();
    // The operator may change the iOS permission in iOS Settings while the app is in the background,
    // so the Settings row reads it again on every resume.
    const readLiveActivityStatus = () => {
      if (platform !== 'ios') return;
      OverdeckLiveActivity.status().then(setLiveActivityStatus, (e: unknown) => console.warn('[live-activity] status failed', e));
    };
    readLiveActivityStatus();
    const uninstallResume = installResumeHandler(() => ({
      directory: directory.client,
      connection,
      resetTransport: () => resetTransport(),
      liveActivity: {
        refresh: () => {
          readLiveActivityStatus();
          return liveActivity.refresh();
        },
      },
    }));
    return () => {
      uninstallResume();
      push?.stop();
      prefsSync?.stop();
      liveActivity.dispose();
      meter.stop();
      directory.client.stop();
      directory.dialer.close();
      setServices(null);
    };
  }, [identity, account]);

  const labelFor = useCallback(
    (link: string) => {
      const environmentId = parsePhonePairLink(link)?.environmentId;
      return services?.directory.client.machines.find((m) => m.environmentId === environmentId)?.label ?? 'the machine';
    },
    [services],
  );

  const pair = useCallback(
    (link: string) => {
      if (!services || !identity || !account) return Promise.reject(new Error('Not signed in.'));
      return pairMachine(link, {
        machines: () => services.directory.client.machines,
        connection: services.connection,
        identity,
        phoneLabel: account.label,
        notificationPreferences: readNotificationPrefs,
        onPreferencesStored: markSynced,
      });
    },
    [services, identity, account],
  );

  // The machine view: a current, paired machine at /m (C-7: switching machines reloads the page).
  const current = paired.find((m) => m.environmentId === currentMachineId()) ?? null;
  const inMachineView = current !== null && location.pathname.startsWith('/m');
  const dialError = useSyncExternalStore(onSessionChange, lastDialError);
  const connection = services?.connection ?? null;
  /** The machine the shims route to; MachineView mounts only after it is set, so its first request finds it. */
  const [sessionFor, setSessionFor] = useState<string | null>(null);
  useEffect(() => {
    if (!inMachineView || !current || !connection) return;
    setSession(current, connection);
    setSessionFor(current.environmentId);
    return () => {
      setSession(null, null);
      setSessionFor(null);
    };
  }, [inMachineView, current, connection]);

  const push = services?.push ?? null;
  const pushState = usePushState(push);

  const { revision, prefs } = useNotificationPrefs();
  const [unsyncedMachines, setUnsyncedMachines] = useState<ReadonlyArray<{ label: string; status: 'pending' | 'outdated' | 'failed' }>>([]);
  useEffect(() => {
    const prefsSync = services?.prefsSync;
    if (!prefsSync) {
      setUnsyncedMachines([]);
      return;
    }
    const recompute = () => {
      setUnsyncedMachines(
        paired.flatMap((m) => {
          const status = prefsSync.status(m.environmentId);
          return status === 'synced' ? [] : [{ label: m.label, status }];
        }),
      );
    };
    recompute();
    return prefsSync.onChange(recompute);
    // `revision` is read indirectly through `prefsSync.status`; re-running on every prefs change
    // catches the case where syncNow() finds no online machine to send to and so never notifies.
  }, [services, paired, revision]);
  const onPause = useCallback((choice: PauseChoice) => writeNotificationPrefs({ ...prefs, pause: pauseFor(choice, new Date()) }), [prefs]);
  const onResume = useCallback(() => writeNotificationPrefs({ ...prefs, pause: null }), [prefs]);
  const onToggleCategory = useCallback(
    (category: PhoneNotificationCategory, on: boolean) =>
      writeNotificationPrefs({ ...prefs, muted: on ? prefs.muted.filter((c) => c !== category) : [...prefs.muted, category] }),
    [prefs],
  );

  const leaveMachine = useCallback((next: View) => {
    setCurrentMachineId(null);
    history.replaceState(null, '', '/');
    setView(next);
  }, []);

  const forget = useCallback(
    async (environmentId: string, next: View = { kind: 'machines' }) => {
      const remaining = paired.filter((m) => m.environmentId !== environmentId);
      await writeMachines(remaining);
      setMachines(remaining);
      leaveMachine(next);
    },
    [paired, setMachines, leaveMachine],
  );

  const runSignOut = useCallback(
    () =>
      signOut({
        machines: paired,
        account,
        removeSelf: services ? removeSelfOver(services.connection) : () => Promise.reject(new Error('no connection')),
        directory: services?.directory.client ?? null,
        deleteDevice: (record) => deleteAccountDevice(record),
        unregisterPush: shellPlatform() === 'android' ? () => unregisterPush('android') : undefined,
        endLiveActivity: shellPlatform() === 'ios' ? () => OverdeckLiveActivity.end() : undefined,
        resetKeys: resetAllKeys,
        clearStorage: () => localStorage.clear(),
        reload: () => navigate('/'),
      }),
    [paired, account, services, navigate],
  );

  const liveActivitySetting = liveActivityStatus && services
    ? {
      available: liveActivityStatus.supported,
      allowed: liveActivityStatus.enabled,
      enabled: liveActivityOn,
      onChange: (on: boolean) => {
        setLiveActivityEnabled(on);
        setLiveActivityOn(on);
        void (on ? services.liveActivity.refresh() : services.liveActivity.disable());
      },
    }
    : null;

  const onPaired = useCallback(
    (machine: PairedMachine) => {
      setCurrentMachineId(machine.environmentId);
      navigate('/m');
    },
    [navigate],
  );

  return (
    <div data-component="mobile-shell" className="fixed inset-0 flex flex-col bg-background text-foreground">
      {boot.kind === 'loading' ? null : boot.kind === 'failed' ? (
        <p role="alert" className="px-4 pt-[calc(env(safe-area-inset-top)+2rem)] text-sm text-destructive">
          {boot.message}
        </p>
      ) : account === null ? (
        <SignInScreen error={signInError} onSignIn={() => startSignIn(boot.identity, shellPlatform())} />
      ) : services === null ? null : inMachineView && current ? (
        dialError?.kind === 'removed' ? (
          <RemovedScreen
            label={current.label}
            onPairAgain={() => leaveMachine({ kind: 'pair', link: null })}
            onForget={() => void forget(current.environmentId)}
          />
        ) : sessionFor !== current.environmentId ? null : (
          <>
            <MachineView
              label={current.label}
              onMachines={() => {
                setCurrentMachineId(null);
                navigate('/');
              }}
            />
            {dialError ? (
              <p
                role="alert"
                className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+3rem)] z-50 rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {dialError.message}
              </p>
            ) : null}
          </>
        )
      ) : view.kind === 'machines' ? (
        <MachinesScreen
          client={services.directory.client}
          paired={paired}
          onPair={() => setView({ kind: 'pair', link: null })}
          onSettings={() => setView({ kind: 'settings' })}
          onSignedOut={() => setAccount(null)}
          navigate={navigate}
        />
      ) : view.kind === 'pair' ? (
        <PairScreen
          key={view.link ?? ''}
          initialLink={view.link}
          labelFor={labelFor}
          pair={pair}
          onPaired={onPaired}
          onCancel={() => setView({ kind: 'machines' })}
        />
      ) : (
        <SettingsScreen
          account={account}
          machines={paired}
          liveActivity={liveActivitySetting}
          onForget={(environmentId) => void forget(environmentId, { kind: 'settings' })}
          onSignOut={runSignOut}
          onBack={() => setView({ kind: 'machines' })}
          notifications={
            push && pushState
              ? {
                ...pushState,
                platform: shellPlatform(),
                onChange: (on) => (on ? void push.enable() : push.disable()),
                prefs,
                onPause,
                onResume,
                onToggleCategory,
                unsynced: unsyncedMachines,
              }
              : undefined
          }
        />
      )}
    </div>
  );
}
