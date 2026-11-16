/**
 * Pair a device (PAN-4445 FR-10): pick or add an address another device can
 * reach, then get a one-time pairing link, its QR code and the expiry time.
 * The link is `<origin>/#pair=<credential>`; the credential rides in the URL
 * fragment only. Only a browser on this machine can create links, so a 403
 * renders an explanation instead of a link.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { QrImage } from './QrImage';
import { Modal } from '../../shared/Modal';
import formStyles from '../../shared/ModalForm.module.css';

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
    <Modal title="Pair a device" size="narrow" onClose={onClose}>
      <div className={formStyles.form} data-component="pair-device-dialog">
        <div className={formStyles.field}>
          <label htmlFor="pair-device-address" className={formStyles.label}>Address the other device opens</label>
          <select
            id="pair-device-address"
            value={selected}
            onChange={(e) => {
              setChoice(e.target.value);
              setAddError(null);
              setPairing(null);
              setForbidden(false);
            }}
            className={formStyles.select}
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
                className={`${formStyles.input} ${formStyles.mono}`}
              />
              {typed.trim() === '' && reachable.length === 0 && (
                <p className={formStyles.hint}>
                  Other devices need an address they can reach, such as https://desk.tailnet.ts.net (Tailscale).
                </p>
              )}
              {typed.trim() !== '' && !typedOrigin && (
                <p className={formStyles.hint}>Enter an http:// or https:// address.</p>
              )}
              {typedOrigin && !typedAddress && (
                <div className="flex items-center justify-between gap-3">
                  <span className={formStyles.hint}>Not trusted yet</span>
                  <button
                    type="button"
                    onClick={() => void handleAdd()}
                    disabled={adding}
                    className={formStyles.button}
                  >
                    Add to trusted addresses
                  </button>
                </div>
              )}
              {typedAddress?.loopback && (
                <p className={formStyles.hint}>
                  This address works only on this machine. Choose “Use this machine only” instead.
                </p>
              )}
              {addError && <p className={formStyles.error}>{addError}</p>}
            </div>
          )}
        </div>

        {forbidden ? (
          <p className={formStyles.hint}>
            Pairing links can be created only from a browser on this machine. Open the dashboard on the machine itself.
          </p>
        ) : pairing ? (
          <div className="space-y-3">
            {pairing.local && <p className={formStyles.hint}>Works only on this machine</p>}
            <div className="flex gap-2">
              <input
                readOnly
                aria-label="Pairing link"
                value={pairing.link}
                onFocus={(e) => e.target.select()}
                className={`${formStyles.input} ${formStyles.mono} flex-1`}
              />
              <button
                type="button"
                onClick={() => void handleCopy()}
                className={`${formStyles.button} shrink-0`}
              >
                Copy
              </button>
            </div>
            {expired ? (
              <div className="flex items-center justify-between gap-3">
                <span className={formStyles.hint}>This link expired</span>
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={creating}
                  className={formStyles.button}
                >
                  New link
                </button>
              </div>
            ) : (
              <>
                <QrImage link={pairing.link} alt="Pairing QR code" />
                <p className={formStyles.hint}>{expiresInText(pairing.expiresAt)}</p>
              </>
            )}
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!linkOrigin || creating}
              className={formStyles.primaryButton}
            >
              Create pairing link
            </button>
          </div>
        )}
        {linkError && <p className={formStyles.error}>{linkError}</p>}
        {newest && <p className={formStyles.text}>Paired: {newest.name}</p>}
      </div>
    </Modal>
  );
}
