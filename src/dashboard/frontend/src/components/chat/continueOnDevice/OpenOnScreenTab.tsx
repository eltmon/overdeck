/**
 * "Open on another screen" (PAN-4455 FR-4..FR-6, D-4, D-5): a link, a Copy
 * button and a QR code for `<reachable address>/conv/<id>`, so another device
 * opens this conversation while this machine stays in charge. For the root
 * session, "Also pair the device" swaps in `…#pair=<credential>` after an
 * explicit click; the credential lives only in this component's state.
 * Loopback addresses are never offered.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { toast } from 'sonner';

import {
  ANYWHERE_STATUS_QUERY_KEY,
  addTrustedAddress,
  apiError,
  isOk,
  issuePairingLink,
  type AnywhereStatus,
} from '../../Settings/anywhere/anywhereApi';
import type { ContinueTarget } from './continueOnDeviceStore';

interface MintedLink {
  link: string;
  expiresAt: number;
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

function expiresInText(expiresAt: number): string {
  const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
  return `Expires in ${minutes} minute${minutes === 1 ? '' : 's'} · works once`;
}

function QrImage({ link }: { link: string }) {
  const src = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    return qr.createDataURL(6, 8);
  }, [link]);
  return <img alt="Conversation QR code" src={src} className="rounded-md bg-white p-1 w-48 h-48" />;
}

const BUTTON = 'rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50';

export function OpenOnScreenTab({ target, status }: { target: ContinueTarget; status: AnywhereStatus }) {
  const queryClient = useQueryClient();
  const reachable = useMemo(() => status.addresses.filter((address) => !address.loopback), [status]);
  const canPair = status.viewer.kind === 'root-session';

  const [choice, setChoice] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [pair, setPair] = useState(true);
  const [minted, setMinted] = useState<MintedLink | null>(null);
  const [expired, setExpired] = useState(false);
  const [creating, setCreating] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const selected = choice ?? reachable[0]?.origin ?? null;
  const options = [
    ...reachable.map((address) => address.origin),
    // Keep a just-added address selectable until the status refetch lists it.
    ...(choice && !reachable.some((address) => address.origin === choice) ? [choice] : []),
  ];

  useEffect(() => {
    if (!minted) return undefined;
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), Math.max(0, minted.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [minted]);

  const base = selected
    ? `${selected.replace(/\/+$/, '')}/conv/${target.id}${target.viewMode === 'terminal' ? '?view=terminal' : ''}`
    : null;
  const shown = minted && !expired ? minted.link : base;

  const handleAdd = async () => {
    const origin = originOf(typed);
    if (!origin) {
      setAddError('Enter an http:// or https:// address.');
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
      setTyped('');
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const handleCreate = async () => {
    if (!base) return;
    setCreating(true);
    setLinkError(null);
    try {
      const result = await issuePairingLink();
      if (result.status === 403) {
        setLinkError('Pairing links can be created only from a browser on this machine. Open the dashboard on the machine itself.');
        return;
      }
      if (!isOk(result)) {
        setLinkError(apiError(result));
        return;
      }
      setMinted({ link: `${base}#pair=${result.body.credential}`, expiresAt: new Date(result.body.expiresAt).getTime() });
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown);
      toast.success('Copied');
    } catch (err) {
      toast.error(`Could not copy: ${(err as Error).message}`);
    }
  };

  if (!selected) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">No address another device can reach is trusted yet.</p>
        {canPair ? (
          <div className="space-y-2">
            <input
              type="url"
              aria-label="Address"
              placeholder="https://desk.tailnet.ts.net"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setAddError(null);
              }}
              className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground font-mono focus:ring-1 focus:ring-primary"
            />
            <button type="button" onClick={() => void handleAdd()} disabled={adding || typed.trim() === ''} className={BUTTON}>
              Add an address
            </button>
            {addError && <p className="text-xs text-destructive">{addError}</p>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Add an address from a browser on this machine (Settings → Anywhere).</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <label htmlFor="continue-address" className="text-xs text-muted-foreground">Address the other device opens</label>
        <select
          id="continue-address"
          aria-label="Address the other device opens"
          value={selected}
          onChange={(e) => {
            setChoice(e.target.value);
            setMinted(null);
            setLinkError(null);
          }}
          className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
        >
          {options.map((origin) => (
            <option key={origin} value={origin}>{origin}</option>
          ))}
        </select>
      </div>

      {canPair && (
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            checked={pair}
            onChange={(e) => {
              setPair(e.target.checked);
              setMinted(null);
              setLinkError(null);
            }}
          />
          Also pair the device
        </label>
      )}

      <div className="flex gap-2">
        <input
          readOnly
          aria-label="Conversation link"
          data-testid="continue-link"
          value={shown ?? ''}
          onFocus={(e) => e.target.select()}
          className="flex-1 min-w-0 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground font-mono"
        />
        <button type="button" onClick={() => void handleCopy()} className={`shrink-0 ${BUTTON}`}>
          Copy
        </button>
      </div>
      {shown && <QrImage link={shown} />}

      {canPair && pair && (
        minted ? (
          expired ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">This link expired</span>
              <button type="button" onClick={() => void handleCreate()} disabled={creating} className={BUTTON}>
                New link
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{expiresInText(minted.expiresAt)}</p>
          )
        ) : (
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            Create pairing link
          </button>
        )
      )}
      {linkError && <p className="text-xs text-destructive">{linkError}</p>}
    </div>
  );
}
