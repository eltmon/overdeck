/**
 * Set up a phone (PAN-2355 FR-7, D-9 to D-11; two tabs added by PAN-4836).
 *
 * "Overdeck app" (PAN-4836, epic PAN-4823 W-MAC2): the native app's pairing
 * QR, built in `SetUpPhoneAppPanel`, and the phones paired with this machine.
 *
 * "Browser on the phone" (`BrowserPhoneSetup`, unchanged): install Tailscale
 * on the phone, choose this machine's https:// address, confirm the
 * token-mint gate, then scan a pairing code that opens the phone shell at
 * `<origin>/m#pair=<code>`. Step 3 reads `dashboard.require_token_mint` and
 * never writes it. While it is off, a phone at the Tailscale Serve address
 * would get the root session (Serve proxies from 127.0.0.1), so step 4 stays
 * hidden until it is on. Pairing reuses the Pair-a-device routes; only the
 * link path differs (`/m`).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { X } from 'lucide-react';

import { ViewToggle } from '../../shared/ViewToggle';
import { openSettingsSection } from '../../../lib/settingsSection';
import { SetUpPhoneAppPanel } from './SetUpPhoneAppPanel';
import {
  ANYWHERE_STATUS_QUERY_KEY,
  addTrustedAddress,
  apiError,
  isOk,
  issuePairingLink,
  loadAnywhereStatus,
  pairingExpiresInText,
} from './anywhereApi';

const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';
const TOKEN_MINT_QUERY_KEY = ['anywhere-require-token-mint'] as const;

type Platform = 'android' | 'iphone';

interface PhonePairing {
  origin: string;
  credential: string;
  expiresAt: number;
}

async function loadRequireTokenMint(): Promise<boolean> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
  const settings = (await res.json()) as { dashboard?: { require_token_mint?: boolean } } | null;
  return settings?.dashboard?.require_token_mint === true;
}

/** `scheme://host[:port]` of an http(s) address, or null. */
function originOf(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function QrImage({ value, alt }: { value: string; alt: string }) {
  const src = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    return qr.createDataURL(6, 8);
  }, [value]);
  return <img alt={alt} src={src} data-qr-value={value} className="rounded-md bg-white p-1 w-48 h-48" />;
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2" aria-labelledby={`set-up-phone-step-${n}`}>
      <h4 id={`set-up-phone-step-${n}`} className="text-sm font-medium text-foreground">{n}. {title}</h4>
      {children}
    </section>
  );
}

export function SetUpPhoneDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <SetUpPhoneDialogBody onClose={onClose} />;
}

function BrowserPhoneSetup({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({ queryKey: ANYWHERE_STATUS_QUERY_KEY, queryFn: loadAnywhereStatus });
  const tokenMint = useQuery({ queryKey: TOKEN_MINT_QUERY_KEY, queryFn: loadRequireTokenMint });

  const [choice, setChoice] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [platform, setPlatform] = useState<Platform>('android');
  const [creating, setCreating] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [pairing, setPairing] = useState<PhonePairing | null>(null);
  const [expired, setExpired] = useState(false);

  const phoneOrigins = useMemo(() => {
    const offered = (status?.addresses ?? [])
      .filter((address) => !address.loopback && address.origin.startsWith('https://'))
      .map((address) => address.origin);
    // Keep a just-added address selectable until the status refetch lists it.
    return choice && !offered.includes(choice) ? [...offered, choice] : offered;
  }, [status, choice]);
  const selected = choice ?? phoneOrigins[0] ?? null;

  useEffect(() => {
    if (!pairing) return undefined;
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), Math.max(0, pairing.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing]);

  const handleAdd = async () => {
    const origin = originOf(typed);
    if (!origin) {
      setAddError('Enter an https:// address.');
      return;
    }
    if (!origin.startsWith('https://')) {
      setAddError('A phone app needs an https:// address.');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const result = await addTrustedAddress(origin);
      if (!isOk(result)) {
        setAddError(apiError(result));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ANYWHERE_STATUS_QUERY_KEY });
      setChoice(result.body.origin);
      setPairing(null);
      setTyped('');
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const handleCreate = async () => {
    if (!selected) return;
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
      setPairing({
        origin: selected.replace(/\/+$/, ''),
        credential: result.body.credential,
        expiresAt: new Date(result.body.expiresAt).getTime(),
      });
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const appUrl = pairing ? `${pairing.origin}/m` : '';
  const pairUrl = pairing ? `${pairing.origin}/m#pair=${pairing.credential}` : '';

  return (
    <div className="p-4 space-y-5 text-sm">
      <Step n={1} title="Install Tailscale">
        <p className="text-xs text-muted-foreground">
          Install Tailscale on your phone and sign in with the same account as this machine.
        </p>
        <QrImage value={TAILSCALE_DOWNLOAD_URL} alt="Tailscale download QR code" />
      </Step>

      <Step n={2} title="Choose this machine's address">
        {phoneOrigins.length > 0 ? (
          <select
            aria-label="Phone address"
            value={selected ?? ''}
            onChange={(e) => {
              setChoice(e.target.value);
              setPairing(null);
              setForbidden(false);
            }}
            className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          >
            {phoneOrigins.map((origin) => <option key={origin} value={origin}>{origin}</option>)}
          </select>
        ) : (
          <p className="text-xs text-muted-foreground">
            No https:// address yet. Run <code>tailscale serve</code> for the dashboard port, then add its address, such as https://desk.tailnet.ts.net.
          </p>
        )}
        <div className="flex gap-2">
          <input
            type="url"
            aria-label="Add an https:// address"
            placeholder="https://desk.tailnet.ts.net"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setAddError(null);
            }}
            className="flex-1 min-w-0 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground font-mono focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={adding || typed.trim() === ''}
            className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {addError && <p className="text-xs text-destructive">{addError}</p>}
      </Step>

      <Step n={3} title="Require a token to sign in">
        {tokenMint.data === true ? (
          <p className="text-xs text-muted-foreground">On. A phone signs in only with its pairing code.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {tokenMint.isError
                ? 'Could not read this setting.'
                : tokenMint.isLoading
                  ? 'Checking the setting…'
                  : 'This setting is off. Tailscale Serve forwards phone traffic from this machine, so the phone would sign in with full access and no pairing. Turn it on before you pair a phone.'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  openSettingsSection('access-tokens');
                  onClose();
                }}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors"
              >
                Open the setting
              </button>
              <button
                type="button"
                onClick={() => void tokenMint.refetch()}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors"
              >
                Check again
              </button>
            </div>
          </div>
        )}
      </Step>

      {tokenMint.data === true && (
        <Step n={4} title="Scan the pairing code with the phone">
          <div className="flex gap-2" role="group" aria-label="Phone type">
            {(['android', 'iphone'] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={platform === p}
                onClick={() => setPlatform(p)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  platform === p ? 'border-primary text-foreground' : 'border-border text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {p === 'android' ? 'Android' : 'iPhone'}
              </button>
            ))}
          </div>

          {forbidden ? (
            <p className="text-xs text-muted-foreground">Pairing links can be created only from a browser on this machine.</p>
          ) : pairing && !expired ? (
            <div className="space-y-3">
              <input
                readOnly
                aria-label="Pairing link"
                value={pairUrl}
                onFocus={(e) => e.target.select()}
                className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground font-mono"
              />
              {platform === 'iphone' ? (
                <>
                  <p className="text-xs text-foreground">1. Open in Safari, then Share → Add to Home Screen</p>
                  <QrImage value={appUrl} alt="Phone app QR code" />
                  <p className="text-xs text-foreground">2. In the installed app, tap Scan pairing code</p>
                  <QrImage value={pairUrl} alt="Pairing QR code" />
                </>
              ) : (
                <QrImage value={pairUrl} alt="Pairing QR code" />
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
                disabled={!selected || creating}
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {expired ? 'Create another code' : 'Create pairing link'}
              </button>
            </div>
          )}
          {linkError && <p className="text-xs text-destructive">{linkError}</p>}
        </Step>
      )}
    </div>
  );
}

function SetUpPhoneDialogBody({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'app' | 'browser'>('app');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-up-phone-title"
        data-component="set-up-phone-dialog"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 id="set-up-phone-title" className="text-base font-medium text-foreground">Set up a phone</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 pt-3">
          <ViewToggle
            ariaLabel="Phone setup"
            options={[{ id: 'app', label: 'Overdeck app' }, { id: 'browser', label: 'Browser on the phone' }]}
            value={tab}
            onChange={setTab}
          />
        </div>

        {tab === 'app' ? (
          <div className="p-4 space-y-5 text-sm">
            <SetUpPhoneAppPanel />
          </div>
        ) : (
          <BrowserPhoneSetup onClose={onClose} />
        )}
      </div>
    </div>
  );
}
