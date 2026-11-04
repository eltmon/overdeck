/**
 * Settings → Anywhere → Public MCP for hosted bots (PAN-4947 FR-7). The switch
 * opens `/mcp` and the OAuth sign-in pages to Tailscale Funnel; the operator
 * runs the shown `tailscale funnel` commands, Overdeck never does.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Toggle } from '../Shared/Toggle';
import { ANYWHERE_PUBLIC_MCP_QUERY_KEY, apiError, isOk, loadPublicMcp, savePublicMcp } from './anywhereApi';

const CODE_CLASS = 'flex-1 min-w-0 block select-all overflow-x-auto whitespace-pre rounded-md border border-border bg-muted/30 px-2 py-1.5 font-mono text-xs text-foreground';
const COPY_CLASS = 'shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/40 transition-colors';

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied');
  } catch (err) {
    toast.error(`Could not copy: ${(err as Error).message}`);
  }
}

function CopyLine({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className={CODE_CLASS}>{value}</code>
      <button type="button" onClick={() => void copyText(value)} aria-label={`Copy ${label}`} className={COPY_CLASS}>
        Copy
      </button>
    </div>
  );
}

export function PublicMcpPanel() {
  const queryClient = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: ANYWHERE_PUBLIC_MCP_QUERY_KEY, queryFn: loadPublicMcp });
  const [saving, setSaving] = useState(false);

  const change = async (next: boolean) => {
    setSaving(true);
    try {
      const result = await savePublicMcp(next);
      if (!isOk(result)) toast.error(apiError(result));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
    await queryClient.invalidateQueries({ queryKey: ANYWHERE_PUBLIC_MCP_QUERY_KEY });
  };

  return (
    <div data-component="public-mcp-panel">
      <h3 className="text-sm font-medium text-foreground mb-2">Public MCP for hosted bots</h3>
      {isLoading ? (
        <p className="text-xs text-muted-foreground px-4 py-3">Loading public MCP…</p>
      ) : error || !data ? (
        <p className="text-xs text-destructive px-4 py-3">Could not load public MCP: {(error as Error | null)?.message ?? 'no data'}</p>
      ) : (
        <div className="space-y-2 px-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13px] text-foreground">Public MCP for hosted bots</p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Anyone on the internet can reach the sign-in page. Only sign-ins you approve in this dashboard get access.
                Turn it off when no hosted bot needs it.
              </p>
            </div>
            <Toggle checked={data.enabled} onChange={(next) => void change(next)} disabled={saving} />
          </div>
          {data.enabled ? (
            <>
              <p className="text-xs text-muted-foreground">Run these on this machine to publish the paths:</p>
              {data.funnelCommands.map((command, index) => (
                <CopyLine key={command} value={command} label={`Funnel command ${index + 1}`} />
              ))}
              <p className="text-xs text-muted-foreground pt-1">Public URL:</p>
              {data.mcpUrl ? (
                <CopyLine value={data.mcpUrl} label="public MCP URL" />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Add this machine's Tailscale address (…ts.net) as a trusted address to see the public URL.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Off. Funnel requests to /mcp and the sign-in pages get 404.</p>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Remove the Funnel paths</summary>
                <div className="space-y-1 pt-1">
                  {data.funnelOffCommands.map((command) => (
                    <code key={command} className={CODE_CLASS}>{command}</code>
                  ))}
                </div>
              </details>
            </>
          )}
        </div>
      )}
    </div>
  );
}
