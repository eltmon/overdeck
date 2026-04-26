/**
 * ZoneBActionStrip — session-scoped action buttons for Zone B.
 *
 * Compact inline strip rendered inside the agent context strip.
 * Exposes stopSession (kill the focused session), viewTerminal
 * (switch Zone C to terminal view), pause/resume lifecycle actions,
 * and an overflow menu for secondary actions (restart, open state dir,
 * view JSONL).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Square, Loader2, Terminal, Pause, Play, MoreHorizontal, FolderOpen, FileText } from 'lucide-react';
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
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [overflowOpen]);

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

  const pauseMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/agents/${session.sessionId}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
      if (!res.ok) throw new Error('Failed to pause session');
      return res.json();
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/agents/${session.sessionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Resumed from dashboard' }),
      });
      if (!res.ok) throw new Error('Failed to resume session');
      return res.json();
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
    },
  });

  const restartMutation = useMutation({
    mutationFn: async () => {
      // Stop current agent
      await fetch(`/api/agents/${session.sessionId}`, { method: 'DELETE' });
      // Extract issueId from sessionId: agent-pan-821 -> PAN-821
      const issueId = session.sessionId.replace(/^agent-/, '').toUpperCase();
      // Start new agent
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId }),
      });
      if (!res.ok) throw new Error('Failed to restart agent');
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

  const handleRestart = async () => {
    const confirmed = await confirm({
      title: 'Restart Agent',
      message: `Stop ${session.sessionId} and start a new work agent?`,
      variant: 'destructive',
      confirmLabel: 'Restart',
    });
    if (confirmed) {
      restartMutation.mutate();
    }
    setOverflowOpen(false);
  };

  const handleOpenStateDir = useCallback(() => {
    const path = `~/.panopticon/agents/${session.sessionId}/`;
    navigator.clipboard?.writeText(path).catch(() => { /* ignore */ });
    setOverflowOpen(false);
  }, [session.sessionId]);

  const handleViewJsonl = useCallback(() => {
    // The conversation panel already shows the JSONL transcript;
    // this action is a no-op placeholder that can be wired to a
    // raw-JSONL viewer if one is added later.
    setOverflowOpen(false);
  }, []);

  const canStop = session.presence === 'active' || session.presence === 'idle';
  const canPause = session.presence === 'active';
  const canResume = session.presence !== 'active';
  const hasTerminal = !!session.tmuxSession;
  const isPending = killMutation.isPending || pauseMutation.isPending || resumeMutation.isPending || restartMutation.isPending;

  if (!canStop && !hasTerminal && !canPause && !canResume) return null;

  return (
    <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
      {canPause && (
        <button
          data-testid="zone-b-pause"
          onClick={() => pauseMutation.mutate()}
          disabled={pauseMutation.isPending || isPending}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent disabled:opacity-50"
          title="Pause session"
        >
          {pauseMutation.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Pause className="w-3 h-3" />
          )}
          Pause
        </button>
      )}
      {canResume && (
        <button
          data-testid="zone-b-resume"
          onClick={() => resumeMutation.mutate()}
          disabled={resumeMutation.isPending || isPending}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent disabled:opacity-50"
          title="Resume session"
        >
          {resumeMutation.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Play className="w-3 h-3" />
          )}
          Resume
        </button>
      )}
      {canStop && (
        <button
          data-testid="zone-b-stop-session"
          onClick={handleStopSession}
          disabled={isKilling || killMutation.isPending || isPending}
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

      {/* Overflow menu */}
      <div style={{ position: 'relative' }} ref={overflowRef}>
        <button
          data-testid="zone-b-overflow"
          onClick={() => setOverflowOpen((o) => !o)}
          className="flex items-center gap-1 px-1 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent"
          title="More actions"
        >
          <MoreHorizontal className="w-3 h-3" />
        </button>
        {overflowOpen && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: '100%',
              marginTop: 4,
              zIndex: 1000,
              background: 'var(--card)',
              border: '1px solid var(--mc-border, var(--border))',
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              padding: '4px 0',
              minWidth: 140,
              fontSize: 12,
            }}
          >
            <OverflowItem
              label="Restart"
              icon={<Play className="w-3 h-3" />}
              onClick={handleRestart}
            />
            <OverflowItem
              label="Open State Dir"
              icon={<FolderOpen className="w-3 h-3" />}
              onClick={handleOpenStateDir}
            />
            {session.hasJsonl && (
              <OverflowItem
                label="View JSONL"
                icon={<FileText className="w-3 h-3" />}
                onClick={handleViewJsonl}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OverflowItem({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '6px 12px',
        border: 'none',
        background: 'none',
        textAlign: 'left',
        cursor: 'pointer',
        color: 'var(--foreground)',
        fontSize: 12,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
