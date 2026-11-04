/** PAN-4655: Settings → Conversations "Auto-settle idle conversations" (app_settings conversations.auto_settle_idle_days). */
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../../lib/wsTransport';

interface AutoSettleView {
  idleDays: number;
}

const QUERY_KEY = ['conversations-auto-settle'];
const ENDPOINT = '/api/conversations/triage/auto-settle';
const INVALID_MESSAGE = 'Enter a whole number from 0 to 365';

async function fetchAutoSettle(): Promise<AutoSettleView> {
  const res = await fetch(ENDPOINT);
  if (!res.ok) throw new Error(`Failed to fetch auto-settle setting (${res.status})`);
  return res.json();
}

async function saveAutoSettle(idleDays: number): Promise<AutoSettleView> {
  await ensureDashboardSession();
  const res = await fetch(ENDPOINT, {
    method: 'PUT',
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ idleDays }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to save auto-settle setting (${res.status})`);
  }
  return res.json();
}

/** A whole number 0..365 typed as digits, else null. */
function parseDays(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return days <= 365 ? days : null;
}

export function AutoSettleIdleRow() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchAutoSettle });
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setText(String(data.idleDays));
  }, [data]);

  const save = useMutation({
    mutationFn: saveAutoSettle,
    onSuccess: (view) => {
      setError(null);
      queryClient.setQueryData(QUERY_KEY, view);
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const commit = () => {
    if (!data || text === String(data.idleDays)) return;
    const days = parseDays(text);
    if (days === null) {
      setError(INVALID_MESSAGE);
      return;
    }
    setError(null);
    save.mutate(days);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit();
  };

  return (
    <div className="px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">Auto-settle idle conversations</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            Settle a conversation after this many days with no activity. 0 turns it off.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={365}
            step={1}
            value={text}
            disabled={!data}
            onChange={(event) => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            aria-label="Days before an idle conversation is settled"
            data-testid="auto-settle-idle-days-input"
            className="w-16 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs text-muted-foreground">days</span>
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
