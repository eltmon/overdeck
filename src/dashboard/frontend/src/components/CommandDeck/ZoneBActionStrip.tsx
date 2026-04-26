/**
 * ZoneBActionStrip — session-scoped action buttons for Zone B.
 *
 * Compact inline strip rendered inside the agent context strip.
 * Exposes stopSession (kill the focused session) and viewTerminal
 * (switch Zone C to terminal view) when applicable.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Square, Loader2, Terminal } from 'lucide-react';
import type { SessionNode as SessionNodeType } from '@panopticon/contracts';
import { useConfirm } from '../DialogProvider';
import { refreshDashboardState } from '../../lib/refresh-dashboard-state';

interface ZoneBActionStripProps {
  session: SessionNodeType;
  onViewTerminal?: () => void;
}

export function ZoneBActionStrip({ session, onViewTerminal }: ZoneBActionStripProps) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [isKilling, setIsKilling] = useState(false);

  const killMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/agents/${session.sessionId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to stop session');
      return res.json();
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
    },
  });

  const handleStopSession = async () => {
    const confirmed = await confirm({
      title: 'Stop Session',
      message: `Stop session ${session.sessionId}?`,
      variant: 'destructive',
      confirmLabel: 'Stop',
    });
    if (confirmed) {
      setIsKilling(true);
      killMutation.mutate(undefined, {
        onSettled: () => setIsKilling(false),
      });
    }
  };

  const canStop = session.presence === 'active' || session.presence === 'idle';
  const hasTerminal = !!session.tmuxSession;

  if (!canStop && !hasTerminal) return null;

  return (
    <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
      {canStop && (
        <button
          data-testid="zone-b-stop-session"
          onClick={handleStopSession}
          disabled={isKilling || killMutation.isPending}
          className="flex items-center gap-1 px-2 py-1 text-xs text-destructive rounded badge-bg-destructive hover:bg-destructive/20 disabled:opacity-50"
          title="Stop session"
        >
          {isKilling || killMutation.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Square className="w-3 h-3" />
          )}
          Stop
        </button>
      )}
      {hasTerminal && onViewTerminal && (
        <button
          data-testid="zone-b-view-terminal"
          onClick={onViewTerminal}
          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent"
          title="View terminal"
        >
          <Terminal className="w-3 h-3" />
          Terminal
        </button>
      )}
    </div>
  );
}
