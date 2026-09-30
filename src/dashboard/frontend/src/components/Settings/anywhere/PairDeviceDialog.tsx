/**
 * Pair a device (PAN-4445 FR-10): pick or add an address another device can
 * reach, then get a one-time pairing link, its QR code and the expiry time.
 * The link is `<origin>/#pair=<credential>`; the credential rides in the URL
 * fragment only. Only a browser on this machine can create links, so a 403
 * renders an explanation instead of a link.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { X } from 'lucide-react';
import { toast } from 'sonner';

import {
  ANYWHERE_DEVICES_QUERY_KEY,
  ANYWHERE_STATUS_QUERY_KEY,
  addTrustedAddress,
  apiError,
  isOk,
  issuePairingLink,
  loadAnywhereStatus,
  loadDevices,
} from './anywhereApi';

const OTHER = '__other__';
const LOCAL = '__local__';

interface PairDeviceDialogProps {
  open: boolean;
  onClose: () => void;
}

interface PairingLink {
  link: string;
  expiresAt: number;
  local: boolean;
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
  return <img alt="Pairing QR code" src={src} className="rounded-md bg-white p-1 w-48 h-48" />;
}

export function PairDeviceDialog({ open, onClose }: PairDeviceDialogProps) {
  if (!open) return null;
  return <PairDeviceDialogBody onClose={onClose} />;
}

function PairDeviceDialogBody({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({ queryKey: ANYWHERE_STATUS_QUERY_KEY, queryFn: loadAnywhereStatus });
  const { data: devices } = useQuery({ queryKey: ANYWHERE_DEVICES_QUERY_KEY, queryFn: loadDevices, refetchInterval: 3000 });

  const reachable = useMemo(() => (status?.addresses ?? []).filter((address) => !address.loopback), [status]);
  const localOrigin = useMemo(() => {
    const here = originOf(window.location.origin);
    const loopback = (status?.addresses ?? []).filter((address) => address.loopback).map((address) => address.origin);
    return here && loopback.includes(here) ? here : (loopback[0] ?? here ?? 'http://localhost:3011');
  }, [status]);

  const [choice, setChoice] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [pairing, setPairing] = useState<PairingLink | null>(null);
  const [expired, setExpired] = useState(false);

  // Default to the first reachable address once the status arrives.
  const selected = choice ?? (reachable[0]?.origin ?? OTHER);

  // Devices active when the dialog opened; a new one means the pairing worked.
  const initialActiveIds = useRef<Set<string> | null>(null);
  const activeDevices = (devices ?? []).filter((device) => !device.revokedAt);
  if (devices && initialActiveIds.current === null) {
    initialActiveIds.current = new Set(activeDevices.map((device) => device.id));
  }
  const newlyPaired = initialActiveIds.current
    ? activeDevices.filter((device) => !initialActiveIds.current?.has(device.id))
    : [];
  const newest = newlyPaired.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  // Refresh the status card's device count as soon as a new device pairs.
  const newestId = newest?.id;
  useEffect(() => {
    if (newestId) void queryClient.invalidateQueries({ queryKey: ANYWHERE_STATUS_QUERY_KEY });
  }, [newestId, queryClient]);

  useEffect(() => {
    if (!pairing) return undefined;
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), Math.max(0, pairing.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing]);

  const typedOrigin = selected === OTHER ? originOf(typed) : null;
  const typedAddress = typedOrigin ? (status?.addresses ?? []).find((address) => address.origin === typedOrigin) : undefined;
  const linkOrigin =
    selected === LOCAL ? localOrigin
      : selected === OTHER ? (typedAddress && !typedAddress.loopback ? typedAddress.origin : null)
        : selected;

  const handleAdd = async () => {
    if (!typedOrigin) return;
    setAdding(true);
    setAddError(null);
    try {
      const result = await addTrustedAddress(typedOrigin);
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
    if (!linkOrigin) return;
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
        link: `${linkOrigin.replace(/\/+$/, '')}${result.body.pairingPath}`,
        expiresAt: new Date(result.body.expiresAt).getTime(),
        local: selected === LOCAL,
      });
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.link);
      toast.success('Copied');
    } catch (err) {
      toast.error(`Could not copy: ${(err as Error).message}`);
    }
  };

  const selectOptions = [
    ...reachable.map((address) => ({ value: address.origin, label: address.origin })),
    // Keep a just-added address selectable until the status refetch lists it.
    ...(choice && choice !== OTHER && choice !== LOCAL && !reachable.some((address) => address.origin === choice)
      ? [{ value: choice, label: choice }]
      : []),
    { value: OTHER, label: 'Another address…' },
    { value: LOCAL, label: `Use this machine only (${localOrigin})` },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pair-device-title"
        data-component="pair-device-dialog"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 id="pair-device-title" className="text-base font-medium text-foreground">Pair a device</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          <div className="space-y-2">
            <label htmlFor="pair-device-address" className="text-xs text-muted-foreground">Address the other device opens</label>
            <select
              id="pair-device-address"
              value={selected}
              onChange={(e) => {
                setChoice(e.target.value);
                setAddError(null);
                setPairing(null);
                setForbidden(false);
              }}
              className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            >
              {selectOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            {selected === OTHER && (
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
                {typed.trim() === '' && reachable.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Other devices need an address they can reach, such as https://desk.tailnet.ts.net (Tailscale).
                  </p>
                )}
                {typed.trim() !== '' && !typedOrigin && (
                  <p className="text-xs text-muted-foreground">Enter an http:// or https:// address.</p>
                )}
                {typedOrigin && !typedAddress && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">Not trusted yet</span>
                    <button
                      type="button"
                      onClick={() => void handleAdd()}
                      disabled={adding}
                      className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                    >
                      Add to trusted addresses
                    </button>
                  </div>
                )}
                {typedAddress?.loopback && (
                  <p className="text-xs text-muted-foreground">
                    This address works only on this machine. Choose “Use this machine only” instead.
                  </p>
                )}
                {addError && <p className="text-xs text-destructive">{addError}</p>}
              </div>
            )}
          </div>

          {forbidden ? (
            <p className="text-xs text-muted-foreground">
              Pairing links can be created only from a browser on this machine. Open the dashboard on the machine itself.
            </p>
          ) : pairing ? (
            <div className="space-y-3">
              {pairing.local && <p className="text-xs text-muted-foreground">Works only on this machine</p>}
              <div className="flex gap-2">
                <input
                  readOnly
                  aria-label="Pairing link"
                  value={pairing.link}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground font-mono"
                />
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors"
                >
                  Copy
                </button>
              </div>
              {expired ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">This link expired</span>
                  <button
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={creating}
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                  >
                    New link
                  </button>
                </div>
              ) : (
                <>
                  <QrImage link={pairing.link} />
                  <p className="text-xs text-muted-foreground">{expiresInText(pairing.expiresAt)}</p>
                </>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!linkOrigin || creating}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Create pairing link
            </button>
          )}
          {linkError && <p className="text-xs text-destructive">{linkError}</p>}
          {newest && <p className="text-xs text-foreground">Paired: {newest.name}</p>}
        </div>
      </div>
    </div>
  );
}
