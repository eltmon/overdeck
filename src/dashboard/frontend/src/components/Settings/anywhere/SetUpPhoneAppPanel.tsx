/**
 * The "Overdeck app" tab of the Set up a phone dialog (PAN-4836, epic PAN-4823
 * W-MAC2, acceptance AC-8). Shows a QR whose text is
 * `ai.overdeck.app:/pair#v=1&e=<environmentId>&k=<machineKeyHex>&c=<odp_code>`
 * (built by `@overdeck/contracts#buildPhonePairLink`) so the native phone app
 * (PAN-4837) can pair with this machine. Needs this machine to be signed in to
 * overdeck.ai (`pan account login`); a signed-out machine shows no code.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { buildPhonePairLink } from '@overdeck/contracts';

import { PairedPhonesList } from './PairedPhonesList';
import { QrImage } from './QrImage';
import { DIRECTORY_QUERY_KEY, loadDirectory } from './directoryApi';
import {
  ANYWHERE_ENVIRONMENT_QUERY_KEY,
  apiError,
  isOk,
  issuePairingLink,
  loadEnvironment,
  pairingExpiresInText,
} from './anywhereApi';

/** Derived from the package id; see https://play.google.com/store/apps/details?id=ai.overdeck.app. */
export const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=ai.overdeck.app';
/**
 * The install guide (PAN-4842) until PAN-4841 creates the App Store record. PAN-4841 swaps this to
 * `https://apps.apple.com/app/id<n>` once the real Apple id exists.
 */
export const APP_STORE_URL = 'https://overdeck.ai/configuration/phone-app';

const NOT_CONNECTED_TEXT = 'This machine is not connected to overdeck.ai right now. A phone can pair once it is.';

interface Pairing {
  credential: string;
  expiresAt: number;
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2" aria-labelledby={`phone-app-step-${n}`}>
      <h4 id={`phone-app-step-${n}`} className="text-sm font-medium text-foreground">{n}. {title}</h4>
      {children}
    </section>
  );
}

export function SetUpPhoneAppPanel() {
  const directory = useQuery({ queryKey: DIRECTORY_QUERY_KEY, queryFn: loadDirectory, refetchInterval: 5000 });
  const environment = useQuery({
    queryKey: ANYWHERE_ENVIRONMENT_QUERY_KEY,
    queryFn: loadEnvironment,
    enabled: directory.data?.signedIn === true,
  });

  const [creating, setCreating] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!pairing) return undefined;
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), Math.max(0, pairing.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing]);

  const handleCreate = async () => {
    setCreating(true);
    setLinkError(null);
    setForbidden(false);
    try {
      const result = await issuePairingLink();
      if (result.status === 403) {
        setForbidden(true);
        setPairing(null);
        return;
      }
      if (!isOk(result)) {
        setLinkError(apiError(result));
        return;
      }
      setPairing({ credential: result.body.credential, expiresAt: new Date(result.body.expiresAt).getTime() });
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const env = environment.data;
  const pairLink = useMemo(() => {
    if (!pairing || !env?.machineKey) return null;
    try {
      return { value: buildPhonePairLink({ environmentId: env.environmentId, machineKeyHex: env.machineKey, code: pairing.credential }), error: null };
    } catch (err) {
      return { value: null, error: (err as Error).message };
    }
  }, [pairing, env]);

  return (
    <>
      <Step n={1} title="Install the Overdeck app">
        <p className="text-xs text-muted-foreground">
          Install Overdeck on the phone and sign in with the same overdeck.ai account as this machine.
        </p>
        <div className="flex gap-2">
          <a href={GOOGLE_PLAY_URL} target="_blank" rel="noreferrer" className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors">
            Google Play
          </a>
          <a href={APP_STORE_URL} target="_blank" rel="noreferrer" className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors">
            App Store
          </a>
        </div>
      </Step>

      <Step n={2} title="Scan the pairing code with the app">
        {directory.isLoading ? (
          <p className="text-xs text-muted-foreground">Checking the overdeck.ai sign-in…</p>
        ) : directory.error ? (
          <p className="text-xs text-destructive">Could not check the overdeck.ai sign-in: {(directory.error as Error).message}</p>
        ) : directory.data?.signedIn === false ? (
          <p data-testid="phone-app-signed-out" className="text-xs text-muted-foreground">
            Sign in to overdeck.ai on this machine first: <span className="font-mono">pan account login</span>
          </p>
        ) : (
          <>
            {directory.data?.state === 'refused' && directory.data.refusal && (
              <p className="text-xs text-warning-foreground">{directory.data.refusal}</p>
            )}
            {(directory.data?.state === 'connecting' || directory.data?.state === 'off') && (
              <p className="text-xs text-warning-foreground">{NOT_CONNECTED_TEXT}</p>
            )}
            {environment.error || (environment.data && !environment.data.machineKey) ? (
              <p className="text-xs text-destructive">
                Could not read this machine's identity: {environment.error ? (environment.error as Error).message : 'no machine key'}
              </p>
            ) : environment.data?.machineKey ? (
              <>
                {forbidden ? (
                  <p className="text-xs text-muted-foreground">Pairing codes can be created only from a browser on this machine.</p>
                ) : pairing && !expired ? (
                  <div className="space-y-3">
                    {pairLink?.value ? (
                      <QrImage link={pairLink.value} alt="Overdeck app pairing QR code" />
                    ) : (
                      <p className="text-xs text-destructive">{pairLink?.error}</p>
                    )}
                    <p className="text-xs text-muted-foreground">{pairingExpiresInText(pairing.expiresAt)}</p>
                    <button
                      type="button"
                      onClick={() => void handleCreate()}
                      disabled={creating}
                      className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                    >
                      Create another code
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {expired && <p className="text-xs text-muted-foreground">This code expired.</p>}
                    <button
                      type="button"
                      onClick={() => void handleCreate()}
                      disabled={creating}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {expired ? 'Create another code' : 'Create pairing code'}
                    </button>
                  </div>
                )}
                {linkError && <p className="text-xs text-destructive">{linkError}</p>}
              </>
            ) : null}
          </>
        )}
      </Step>

      <PairedPhonesList />
    </>
  );
}
