/**
 * ZoneBActionStrip — session-scoped action buttons for Zone B.
 *
 * Compact inline strip rendered inside the agent context strip.
 * Exposes stopSession (kill the focused session), viewTerminal
 * (switch Zone C to terminal view), pause/resume lifecycle actions,
 * and an overflow menu for secondary actions (restart, open state dir,
 * view JSONL, deep wipe, replay, export JSONL, export round history).
 */

import { Fragment, useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Square, Loader2, Terminal, Pause, Play, MoreHorizontal,
  FolderOpen, FileText, Trash2, RotateCcw, Download, History,
  BookText, Copy, ClipboardCopy,
} from 'lucide-react';
import type { SessionNode as SessionNodeType } from '@overdeck/contracts';
import { useConfirm } from '../DialogProvider';
import { refreshDashboardState } from '../../lib/refresh-dashboard-state';
import { isCodexBlockedResponse, setPendingCodexSpawn } from '../../lib/pending-codex-spawn';
import {
  ZONE_B_SESSION_ACTIONS,
  type NonIssueActionContext,
  type NonIssueActionEntry,
  type NonIssueActionKey,
} from '../../lib/issueActions';

interface ZoneBActionStripProps {
  session: SessionNodeType;
  issueId?: string;
  onViewTerminal?: () => void;
}

const INLINE_ACTION_KEYS = new Set<NonIssueActionKey>([
  'pauseSession',
  'resumeFocusedSession',
  'stopSession',
  'viewTerminal',
]);

export function ZoneBActionStrip({ session, issueId, onViewTerminal }: ZoneBActionStripProps) {
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
      if (session.type !== 'work') throw new Error('Cannot restart non-work sessions');
      await fetch(`/api/agents/${session.sessionId}`, { method: 'DELETE' });
      const targetIssueId = issueId ?? session.sessionId.replace(/^agent-/, '').toUpperCase();
      const requestBody = { issueId: targetIssueId };
      let lastRequestBody: Record<string, unknown> = requestBody;
      let res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lastRequestBody),
      });
      let data = await res.json().catch(() => ({})) as { error?: string; hint?: string; blocked?: boolean; requiresAcknowledgement?: boolean; guardrails?: { warnings?: Array<{ message: string }> } };
      if (res.status === 409 && data.requiresAcknowledgement) {
        const confirmed = window.confirm((data.guardrails?.warnings ?? []).map((warning) => `• ${warning.message}`).join('\n'));
        if (!confirmed) throw new Error('Agent start canceled');
        lastRequestBody = { ...requestBody, guardrailAcknowledged: true };
        res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lastRequestBody),
        });
        data = await res.json().catch(() => ({})) as { error?: string; hint?: string; blocked?: boolean; guardrails?: { warnings?: Array<{ message: string }> } };
      }
      if (!res.ok) {
        if (isCodexBlockedResponse(res, data)) {
          setPendingCodexSpawn(lastRequestBody);
          throw new Error(data.hint || data.error || 'Codex authentication expired — re-authenticate to continue');
        }
        throw new Error(data.error || data.hint || 'Failed to restart agent');
      }
      return data;
    },
    onSuccess: async (data) => {
      if ((data.guardrails?.warnings ?? []).length > 0) {
        toast.success('Agent started after acknowledging system health warnings.', { duration: 6000 });
      }
      await refreshDashboardState(queryClient);
    },
  });

  const handleStopSession = useCallback(() => {
    setIsKilling(true);
    killMutation.mutate(undefined, {
      onSettled: () => setIsKilling(false),
    });
  }, [killMutation]);

  const handleRestart = useCallback(() => {
    restartMutation.mutate();
  }, [restartMutation]);

  const handleOpenStateDir = useCallback(() => {
    const path = `~/.overdeck/agents/${session.sessionId}/`;
    navigator.clipboard?.writeText(path).catch(() => { /* ignore */ });
    setOverflowOpen(false);
  }, [session.sessionId]);

  const handleDeepWipe = useCallback(async (targetIssueId: string) => {
    try {
      const res = await fetch(`/api/issues/${targetIssueId}/deep-wipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteWorkspace: true }),
      });
      if (!res.ok) throw new Error('Failed to deep wipe');
      await refreshDashboardState(queryClient);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to deep wipe');
    }
  }, [queryClient]);

  const handleExportSessionMetadata = useCallback(() => {
    const blob = new Blob(
      [JSON.stringify({ sessionId: session.sessionId, exportedAt: new Date().toISOString() }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setOverflowOpen(false);
  }, [session.sessionId]);

  const handleExportRoundHistory = useCallback(() => {
    const blob = new Blob(
      [JSON.stringify(session.roundMetadata ?? {}, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.sessionId}-rounds.json`;
    a.click();
    URL.revokeObjectURL(url);
    setOverflowOpen(false);
  }, [session.sessionId, session.roundMetadata]);

  const handleReplay = useCallback(() => {
    onViewTerminal?.();
    setOverflowOpen(false);
  }, [onViewTerminal]);

  const handleViewState = useCallback(() => {
    const path = `~/.overdeck/agents/${session.sessionId}/`;
    navigator.clipboard?.writeText(path).catch(() => { /* ignore */ });
    toast.success('State dir path copied');
    setOverflowOpen(false);
  }, [session.sessionId]);

  const handleViewXbrief = useCallback(() => {
    if (issueId) {
      const path = `workspaces/feature-${issueId.toLowerCase()}/.pan/spec.vbrief.json`;
      navigator.clipboard?.writeText(path).catch(() => { /* ignore */ });
      toast.success('xBRIEF path copied');
    }
    setOverflowOpen(false);
  }, [issueId]);

  const handleCopySessionId = useCallback(() => {
    navigator.clipboard?.writeText(session.sessionId).catch(() => { /* ignore */ });
    toast.success('Session ID copied');
    setOverflowOpen(false);
  }, [session.sessionId]);

  const handleCopyTmuxCommand = useCallback(() => {
    if (session.tmuxSession) {
      navigator.clipboard?.writeText(`tmux attach-session -t ${session.tmuxSession}`).catch(() => { /* ignore */ });
      toast.success('tmux command copied');
    }
    setOverflowOpen(false);
  }, [session.tmuxSession]);

  const actionContext = {
    sessionId: session.sessionId,
    issueId,
    sessionType: session.type,
    sessionPresence: session.presence,
    tmuxSession: session.tmuxSession,
    hasJsonl: session.hasJsonl,
    roundCount: session.roundMetadata?.roundCount,
    onStopSession: handleStopSession,
    onViewTerminal: onViewTerminal ? () => onViewTerminal() : undefined,
    onPauseSession: () => pauseMutation.mutate(),
    onResumeSession: () => resumeMutation.mutate(),
    onRestartSession: handleRestart,
    onReplaySession: onViewTerminal ? handleReplay : undefined,
    onOpenStateDir: handleOpenStateDir,
    onViewState: handleViewState,
    onViewXbrief: handleViewXbrief,
    onCopySessionId: handleCopySessionId,
    onCopyTmuxCommand: handleCopyTmuxCommand,
    onExportSessionMetadata: handleExportSessionMetadata,
    onExportRoundHistory: handleExportRoundHistory,
    onDeepWipe: handleDeepWipe,
  } satisfies NonIssueActionContext;
  const availableActions = ZONE_B_SESSION_ACTIONS
    .filter((action) => action.ownerSurface === 'ZoneBActionStrip' && action.scope === 'session')
    .filter((action) => action.enabledWhen(actionContext));
  const actionByKey = new Map(availableActions.map((action) => [action.key, action]));
  const pauseAction = actionByKey.get('pauseSession');
  const resumeAction = actionByKey.get('resumeFocusedSession');
  const stopAction = actionByKey.get('stopSession');
  const terminalAction = actionByKey.get('viewTerminal');
  const overflowActions = availableActions.filter((action) => !INLINE_ACTION_KEYS.has(action.key));
  const isPending = killMutation.isPending || pauseMutation.isPending || resumeMutation.isPending || restartMutation.isPending;

  const invokeAction = async (action: NonIssueActionEntry) => {
    if (action.confirm) {
      const confirmed = await confirm({
        title: action.confirm.title,
        message: action.confirm.message(actionContext),
        variant: action.confirm.variant,
        confirmLabel: action.confirm.confirmLabel,
      });
      if (!confirmed) return;
    }
    await action.invoke(actionContext);
  };

  if (availableActions.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
      {pauseAction && (
        <button
          data-testid="zone-b-pause"
          data-action-key={pauseAction.key}
          onClick={() => { void invokeAction(pauseAction); }}
          disabled={pauseMutation.isPending || isPending}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent disabled:opacity-50"
          title={pauseAction.description}
        >
          {pauseMutation.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Pause className="w-3 h-3" />
          )}
          {pauseAction.label}
        </button>
      )}
      {resumeAction && (
        <button
          data-testid="zone-b-resume"
          data-action-key={resumeAction.key}
          onClick={() => { void invokeAction(resumeAction); }}
          disabled={resumeMutation.isPending || isPending}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent disabled:opacity-50"
          title={resumeAction.description}
        >
          {resumeMutation.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Play className="w-3 h-3" />
          )}
          {resumeAction.label}
        </button>
      )}
      {stopAction && (
        <button
          data-testid="zone-b-stop-session"
          data-action-key={stopAction.key}
          onClick={() => { void invokeAction(stopAction); }}
          disabled={isKilling || killMutation.isPending || isPending}
          className="flex items-center gap-1 px-2 py-1 text-xs text-destructive rounded badge-bg-destructive hover:bg-destructive/20 disabled:opacity-50"
          title={stopAction.description}
        >
          {isKilling || killMutation.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Square className="w-3 h-3" />
          )}
          {stopAction.label}
        </button>
      )}
      {terminalAction && (
        <button
          data-testid="zone-b-view-terminal"
          data-action-key={terminalAction.key}
          onClick={() => { void invokeAction(terminalAction); }}
          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:text-foreground hover:bg-accent"
          title={terminalAction.description}
        >
          <Terminal className="w-3 h-3" />
          {terminalAction.label}
        </button>
      )}

      {/* Overflow menu */}
      {overflowActions.length > 0 ? (
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
                border: '1px solid var(--border)',
                borderRadius: 6,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                padding: '4px 0',
                minWidth: 160,
                fontSize: 12,
              }}
            >
              {overflowActions.map((action) => (
                <Fragment key={action.key}>
                  {action.key === 'deepWipe' ? <MenuDivider /> : null}
                  <OverflowItem
                    actionKey={action.key}
                    label={action.label}
                    icon={<ZoneBActionIcon actionKey={action.key} />}
                    variant={action.kind === 'destructive' ? 'danger' : 'default'}
                    onClick={() => {
                      void invokeAction(action).finally(() => setOverflowOpen(false));
                    }}
                  />
                </Fragment>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ZoneBActionIcon({ actionKey }: { actionKey: NonIssueActionKey }) {
  switch (actionKey) {
    case 'restartSession':
    case 'replaySession':
      return <RotateCcw className="w-3 h-3" />;
    case 'openStateDir':
      return <FolderOpen className="w-3 h-3" />;
    case 'viewState':
    case 'viewJsonl':
      return <FileText className="w-3 h-3" />;
    case 'viewFocusedXbrief':
      return <BookText className="w-3 h-3" />;
    case 'copySessionId':
      return <Copy className="w-3 h-3" />;
    case 'copyTmuxCommand':
      return <ClipboardCopy className="w-3 h-3" />;
    case 'exportSessionMetadata':
      return <Download className="w-3 h-3" />;
    case 'exportRoundHistory':
      return <History className="w-3 h-3" />;
    case 'deepWipe':
      return <Trash2 className="w-3 h-3" />;
    default:
      return null;
  }
}

function MenuDivider() {
  return (
    <div
      style={{
        height: 1,
        background: 'var(--border)',
        margin: '4px 8px',
      }}
    />
  );
}

function OverflowItem({
  actionKey,
  label,
  icon,
  variant = 'default',
  onClick,
}: {
  actionKey: NonIssueActionKey;
  label: string;
  icon: React.ReactNode;
  variant?: 'default' | 'danger';
  onClick: () => void;
}) {
  return (
    <button
      data-action-key={actionKey}
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
        color: variant === 'danger' ? 'var(--destructive)' : 'var(--foreground)',
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
