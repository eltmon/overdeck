/** The account's machines from the overdeck.ai directory (PAN-4837 FR-5, FR-10, FR-11). */
import type { DirectoryWebClient } from '@overdeck/anywhere-channel/web';
import type { DirectoryMachine } from '@overdeck/contracts';

import {
  LogoWatermark,
  MOBILE_ROW_META_CLASS,
  MOBILE_ROW_TITLE_CLASS,
  MobileEmptyState,
  MobileScreenHeader,
  OverdeckLockup,
  PlusIcon,
  SettingsIcon,
} from '../../../../src/dashboard/frontend/src/components/mobile/brand';

import { MIN_PAN_VERSION } from './config';
import { connectionText } from './connection';
import { useDirectoryMachines, useDirectoryState } from './directory';
import { removeAccount, setCurrentMachineId } from './store';
import type { PairedMachine } from './types';
import { compareVersions } from './version';

/** The directory's close-4001 refusal (`directory-web.ts`). */
export const UNAUTHORIZED_REFUSAL = 'overdeck.ai rejected this sign-in; sign in again';

interface MachinesScreenProps {
  client: DirectoryWebClient;
  paired: readonly PairedMachine[];
  onPair(machine: DirectoryMachine | null): void;
  onSettings(): void;
  /** Called after "Sign in again" removed the account secret. */
  onSignedOut(): void;
  /** Default `location.assign`: switching machines reloads the page (C-7). */
  navigate?: (path: string) => void;
}

const HEADER_ICON_BUTTON = 'flex min-h-11 min-w-11 items-center justify-center text-muted-foreground active:text-foreground';

export function isOutdated(machine: DirectoryMachine): boolean {
  return compareVersions(machine.serverVersion, MIN_PAN_VERSION) < 0;
}

export function MachinesScreen({ client, paired, onPair, onSettings, onSignedOut, navigate = (path) => location.assign(path) }: MachinesScreenProps) {
  const state = useDirectoryState(client);
  const machines = useDirectoryMachines(client);
  const pairedIds = new Set(paired.map((m) => m.environmentId));
  const rows = [...machines].sort((a, b) => {
    const pairedOrder = Number(pairedIds.has(b.environmentId)) - Number(pairedIds.has(a.environmentId));
    return pairedOrder !== 0 ? pairedOrder : a.label.localeCompare(b.label);
  });

  const open = (machine: DirectoryMachine) => {
    if (!pairedIds.has(machine.environmentId)) {
      onPair(machine);
      return;
    }
    setCurrentMachineId(machine.environmentId);
    navigate('/m');
  };

  return (
    <section data-component="machines-screen" className="flex min-h-0 flex-1 flex-col">
      <MobileScreenHeader
        leading={<OverdeckLockup className="h-6" />}
        trailing={
          <>
            <button type="button" onClick={() => onPair(null)} className={HEADER_ICON_BUTTON}>
              <PlusIcon className="h-5 w-5" aria-hidden />
              <span className="sr-only">Pair a machine</span>
            </button>
            <button type="button" onClick={onSettings} className={`${HEADER_ICON_BUTTON} -mr-2`}>
              <SettingsIcon className="h-5 w-5" aria-hidden />
              <span className="sr-only">Settings</span>
            </button>
          </>
        }
      />
      {state === 'connecting' ? <p className="px-4 pt-3 text-sm text-muted-foreground">Connecting to overdeck.ai…</p> : null}
      {state === 'refused' ? (
        <div className="flex flex-col gap-2 px-4 pt-3">
          <p role="alert" className="text-sm text-destructive">{client.refusal}</p>
          {client.refusal === UNAUTHORIZED_REFUSAL ? (
            <button
              type="button"
              onClick={() => void removeAccount().then(onSignedOut)}
              className="min-h-11 w-full rounded-sm border border-border px-3 text-sm font-medium text-foreground"
            >
              Sign in again
            </button>
          ) : null}
        </div>
      ) : null}
      {state === 'off' ? <p className="px-4 pt-3 text-sm text-muted-foreground">{connectionText.directoryOffline()}</p> : null}
      {/* PAN-5208 D-14: the faint watermark sits behind the scroller and never takes taps. */}
      <div className="relative min-h-0 flex-1">
        <LogoWatermark />
        <div className="relative h-full overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          <h2 className="px-4 pb-1 pt-4 text-sm font-medium text-foreground">Machines</h2>
          {state === 'online' && rows.length === 0 ? (
            <MobileEmptyState title="No machines yet." detail="Pair a machine to see it here." />
          ) : null}
          <ul>
            {rows.map((machine) => {
              const isPaired = pairedIds.has(machine.environmentId);
              // Advisory only: a development build ahead of the last release reports the old version.
              // Pairing checks the machine's capabilities, and a paired machine has already passed.
              const outdated = !isPaired && isOutdated(machine);
              const disabled = isPaired && !machine.online;
              return (
                <li key={machine.environmentId} className="border-b border-border">
                  <button
                    type="button"
                    data-environment-id={machine.environmentId}
                    disabled={disabled}
                    onClick={() => open(machine)}
                    className="flex min-h-14 w-full flex-col items-start gap-1 px-4 py-3 text-left active:bg-muted disabled:opacity-60"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span
                        aria-label={machine.online ? 'online' : 'offline'}
                        className={`h-2 w-2 shrink-0 rounded-full ${machine.online ? 'bg-success' : 'bg-muted-foreground'}`}
                      />
                      <span className={MOBILE_ROW_TITLE_CLASS}>{machine.label}</span>
                      {isPaired ? (
                        <span className="ml-auto shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          Paired
                        </span>
                      ) : null}
                    </span>
                    <span className={`${MOBILE_ROW_META_CLASS} font-mono`}>{machine.fingerprint}</span>
                    {outdated ? <span className={MOBILE_ROW_META_CLASS}>{connectionText.outdated(machine.label)}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
