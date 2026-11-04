/**
 * Copy MCP URL (PAN-4649 FR-9): mint an MCP access token and hand an MCP
 * client the URL, header and config it needs. The URL is `<address>/mcp` and
 * never carries the token (D-4649-1); the token travels only in the
 * `Authorization` header, shown once. Default scopes are `read:state`,
 * `read:conversations` and `operate`; the checkbox adds `approve`
 * (D-4649-3). Only a browser on this machine can mint tokens, so a 403
 * renders an explanation (D-4649-10).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from 'sonner';

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
  const fieldClass = 'flex-1 min-w-0 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground font-mono';
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex gap-2 items-start">
        {multiline ? (
          <textarea readOnly aria-label={label} value={value} rows={8} className={`${fieldClass} resize-none`} />
        ) : (
          <input readOnly aria-label={label} value={value} onFocus={(e) => e.target.select()} className={fieldClass} />
        )}
        <button
          type="button"
          onClick={() => void copyText(value, label)}
          aria-label={`Copy ${label}`}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors"
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-lg mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-url-title"
        data-component="mcp-url-dialog"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 id="mcp-url-title" className="text-base font-medium text-foreground">Copy MCP URL</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          {minted ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">This token is shown once.</p>
              <CopyField label="URL" value={minted.url} />
              <CopyField label="Header" value={`Authorization: Bearer ${minted.token}`} />
              <CopyField label="Client config" value={mcpClientConfig(minted.url, minted.token)} multiline />
              <CopyField
                label="Claude Code command"
                value={`claude mcp add --transport http overdeck ${minted.url} --header "Authorization: Bearer ${minted.token}"`}
              />
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <label htmlFor="mcp-url-name" className="text-xs text-muted-foreground">Name</label>
                <input
                  id="mcp-url-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="mcp-url-address" className="text-xs text-muted-foreground">Address</label>
                <select
                  id="mcp-url-address"
                  value={address}
                  onChange={(e) => setChoice(e.target.value)}
                  className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                >
                  {options.map((origin) => (
                    <option key={origin} value={origin}>{origin}</option>
                  ))}
                </select>
                {noReachable && (
                  <>
                    {noReachableMessage && <p className="text-xs text-muted-foreground">{noReachableMessage}</p>}
                    <p className="text-xs text-muted-foreground">Works only on this machine</p>
                  </>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input type="checkbox" checked={allowApprove} onChange={(e) => setAllowApprove(e.target.checked)} />
                Allow answering questions and approving permissions
              </label>
              {forbidden ? (
                <p className="text-xs text-muted-foreground">Only a browser on this machine can create MCP tokens.</p>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={creating}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  Create and copy URL
                </button>
              )}
            </>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}
