/**
 * Copy MCP URL (PAN-4649 FR-9): mint an MCP access token and hand an MCP
 * client the URL, header and config it needs. The URL is `<address>/mcp` and
 * never carries the token (D-4649-1); the token travels only in the
 * `Authorization` header, shown once. Default scopes are `read:state`,
 * `read:conversations` and `operate`; the checkbox adds `approve`
 * (D-4649-3). Only a browser on this machine can mint tokens, so a 403
 * renders an explanation (D-4649-10).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Modal } from '../../shared/Modal';
import formStyles from '../../shared/ModalForm.module.css';
import {
  ANYWHERE_ACCESS_TOKENS_QUERY_KEY,
  ANYWHERE_STATUS_QUERY_KEY,
  MCP_DEFAULT_SCOPES,
  apiError,
  createAccessToken,
  isOk,
  loadAnywhereStatus,
  mcpClientConfig,
} from './anywhereApi';

interface McpUrlDialogProps {
  open: boolean;
  onClose: () => void;
}

interface MintedMcp {
  url: string;
  token: string;
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

async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch (err) {
    toast.error(`Could not copy: ${(err as Error).message}`);
  }
}

export function CopyField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={formStyles.field}>
      <span className={formStyles.label}>{label}</span>
      <div className="flex gap-2 items-start">
        {multiline ? (
          <textarea
            readOnly
            aria-label={label}
            value={value}
            rows={8}
            className={`${formStyles.textarea} ${formStyles.mono} flex-1 min-w-0`}
            style={{ resize: 'none' }}
          />
        ) : (
          <input readOnly aria-label={label} value={value} onFocus={(e) => e.target.select()} className={`${formStyles.input} ${formStyles.mono} flex-1 min-w-0`} />
        )}
        <button
          type="button"
          onClick={() => void copyText(value, label)}
          aria-label={`Copy ${label}`}
          className={`${formStyles.button} shrink-0`}
        >
          Copy
        </button>
      </div>
    </div>
  );
}

export function McpUrlDialog({ open, onClose }: McpUrlDialogProps) {
  if (!open) return null;
  return <McpUrlDialogBody onClose={onClose} />;
}

function McpUrlDialogBody({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({ queryKey: ANYWHERE_STATUS_QUERY_KEY, queryFn: loadAnywhereStatus });

  // D-4649-9: reachable addresses, the first https:// one preselected; with
  // none, this browser's origin, which works only on this machine.
  const reachable = useMemo(() => (status?.addresses ?? []).filter((address) => !address.loopback).map((address) => address.origin), [status]);
  const localOrigin = originOf(window.location.origin) ?? 'http://localhost:3011';
  const options = reachable.length > 0 ? reachable : [localOrigin];
  const preferred = reachable.find((origin) => origin.startsWith('https://')) ?? options[0] ?? localOrigin;
  const noReachable = status !== undefined && reachable.length === 0;
  const noReachableMessage = status?.problems.find((problem) => problem.code === 'no-reachable-address')?.message;

  const [name, setName] = useState('MCP client');
  const [choice, setChoice] = useState<string | null>(null);
  const [allowApprove, setAllowApprove] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [minted, setMinted] = useState<MintedMcp | null>(null);
  const mintedRef = useRef<HTMLDivElement>(null);

  // The result replaces the form (and its focused button); keep focus inside
  // the dialog so Escape and the Tab trap still work (D6).
  useEffect(() => {
    if (minted) mintedRef.current?.closest<HTMLElement>('[data-component="modal"]')?.focus();
  }, [minted]);

  const address = choice ?? preferred;

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    setForbidden(false);
    try {
      const scopes = allowApprove ? [...MCP_DEFAULT_SCOPES, 'approve'] : [...MCP_DEFAULT_SCOPES];
      const result = await createAccessToken(name.trim() || 'MCP client', scopes);
      if (result.status === 403) {
        setForbidden(true);
        return;
      }
      if (!isOk(result)) {
        setError(apiError(result));
        return;
      }
      const url = `${address.replace(/\/+$/, '')}/mcp`;
      setMinted({ url, token: result.body.token });
      void queryClient.invalidateQueries({ queryKey: ANYWHERE_ACCESS_TOKENS_QUERY_KEY });
      await copyText(url, 'MCP URL');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal title="Copy MCP URL" onClose={onClose}>
      {minted ? (
        <div ref={mintedRef} className={`${formStyles.content} space-y-3`} data-component="mcp-url-dialog">
          <p className={formStyles.hint}>This token is shown once.</p>
          <CopyField label="URL" value={minted.url} />
          <CopyField label="Header" value={`Authorization: Bearer ${minted.token}`} />
          <CopyField label="Client config" value={mcpClientConfig(minted.url, minted.token)} multiline />
          <CopyField
            label="Claude Code command"
            value={`claude mcp add --transport http overdeck ${minted.url} --header "Authorization: Bearer ${minted.token}"`}
          />
          {error && <p className={formStyles.error}>{error}</p>}
        </div>
      ) : (
        <div className={formStyles.form} data-component="mcp-url-dialog">
          <div className={formStyles.field}>
            <label htmlFor="mcp-url-name" className={formStyles.label}>Name</label>
            <input
              id="mcp-url-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={formStyles.input}
            />
          </div>
          <div className={formStyles.field}>
            <label htmlFor="mcp-url-address" className={formStyles.label}>Address</label>
            <select
              id="mcp-url-address"
              value={address}
              onChange={(e) => setChoice(e.target.value)}
              className={`${formStyles.select} ${formStyles.mono}`}
            >
              {options.map((origin) => (
                <option key={origin} value={origin}>{origin}</option>
              ))}
            </select>
            {noReachable && (
              <>
                {noReachableMessage && <p className={formStyles.hint}>{noReachableMessage}</p>}
                <p className={formStyles.hint}>Works only on this machine</p>
              </>
            )}
          </div>
          <label className={formStyles.choice}>
            <input type="checkbox" checked={allowApprove} onChange={(e) => setAllowApprove(e.target.checked)} />
            <span className={formStyles.choiceTitle}>Allow answering questions and approving permissions</span>
          </label>
          {forbidden ? (
            <p className={formStyles.hint}>Only a browser on this machine can create MCP tokens.</p>
          ) : (
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className={`${formStyles.primaryButton} self-start`}
            >
              Create and copy URL
            </button>
          )}
          {error && <p className={formStyles.error}>{error}</p>}
        </div>
      )}
    </Modal>
  );
}
