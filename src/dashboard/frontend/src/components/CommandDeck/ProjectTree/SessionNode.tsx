import { useCallback, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Code2,
  Compass,
  Eye,
  FlaskConical,
  GitMerge,
  ShieldCheck,
  Lock,
  Gauge,
  ClipboardList,
  Layers,
  Archive,
  type LucideIcon,
} from 'lucide-react';
import { useLiveFlash } from '../../../lib/useLiveFlash';
import type { SessionNode as SessionNodeType, Activity, AgentRuntimeSnapshot } from '@panctl/contracts';
import { StatusDot, type StatusDotStatus } from '../StatusDot';
import { useAvailableModels, type ModelGroup } from '../../shared/ModelPicker/ModelPicker';
import { useResolvedModels, resolveWorkTypeKey } from '../../../lib/useResolvedModels';
import { useDashboardStore } from '../../../lib/store';
import { useSharedTick } from '../../../lib/useSharedTick';
import { formatRelativeTime } from '../../../lib/formatRelativeTime';
import styles from '../styles/command-deck.module.css';
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuDestructiveItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '../../shared/ContextMenu';

function stalenessColor(ms: number): string {
  if (ms < 2 * 60_000)  return 'var(--success)';
  if (ms < 10 * 60_000) return 'var(--warning)';
  if (ms < 30 * 60_000) return 'var(--orange, #f97316)';
  return 'var(--destructive)';
}

function LiveLastHeard({ lastActivity }: { lastActivity?: string }) {
  const now = useSharedTick();
  if (!lastActivity) return null;
  const ms = now.getTime() - new Date(lastActivity).getTime();
  if (ms < 1000) return null;
  const label = formatRelativeTime(lastActivity, now);
  const color = stalenessColor(ms);
  return (
    <span
      style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums', color, flexShrink: 0 }}
      title={`Last heard: ${label}`}
    >
      {label}
    </span>
  );
}


function activityToStatus(activity: Activity): StatusDotStatus {
  switch (activity) {
    case 'working': return 'active';
    case 'thinking': return 'thinking';
    case 'waiting': return 'waiting';
    case 'idle': return 'idle';
    case 'stopped': return 'ended';
    default: return 'ended';
  }
}

function presenceToStatus(presence: SessionNodeType['presence']): StatusDotStatus {
  switch (presence) {
    case 'active': return 'active';
    case 'idle': return 'idle';
    case 'suspended': return 'waiting';
    case 'ended': return 'ended';
    default: return 'ended';
  }
}

function effectiveActivity(runtime: AgentRuntimeSnapshot | undefined, presence: SessionNodeType['presence']): Activity | undefined {
  if (!runtime?.activity) return undefined;
  // agent.stopped sets activity="stopped" but tmux session may still be alive (pan done).
  // If presence says alive, treat as idle — the agent finished work but isn't dead.
  if (runtime.activity === 'stopped' && presence !== 'ended') return 'idle';
  return runtime.activity;
}

function deriveDotStatus(runtime: AgentRuntimeSnapshot | undefined, presence: SessionNodeType['presence']): StatusDotStatus {
  const activity = effectiveActivity(runtime, presence);
  if (activity) return activityToStatus(activity);
  return presenceToStatus(presence);
}

function ReviewerVerdict({ session, dotStatus }: { session: SessionNodeType; dotStatus: StatusDotStatus }) {
  const { latestStatus, latestReviewResult } = session.roundMetadata ?? {};
  if (latestReviewResult === 'APPROVED') {
    return <CircleCheck size={10} style={{ color: 'var(--success)', flexShrink: 0 }} />;
  }
  if (latestReviewResult === 'CHANGES_REQUESTED' || latestStatus === 'failed') {
    return <CircleX size={10} style={{ color: 'var(--destructive)', flexShrink: 0 }} />;
  }
  return <StatusDot status={dotStatus} size="sm" />;
}

interface SessionNodeProps {
  session: SessionNodeType;
  issueId?: string;
  isSelected?: boolean;
  onClick?: () => void;
  onStopSession?: (sessionId: string) => void;
  onViewTerminal?: (sessionId: string) => void;
  onPauseSession?: (sessionId: string) => void;
  onResumeSession?: (sessionId: string) => void;
  onRestartSession?: (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string) => void;
  onDeepWipe?: (issueId: string) => void;
  onOpenStateDir?: (sessionId: string) => void;
  onViewJsonl?: (sessionId: string) => void;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

const TYPE_ICON: Record<string, LucideIcon> = {
  work: Code2,
  planning: Compass,
  review: Eye,
  test: FlaskConical,
  merge: GitMerge,
  legacy: Archive,
};

const REVIEWER_ROLE_ICON: Record<string, LucideIcon> = {
  correctness: ShieldCheck,
  security: Lock,
  performance: Gauge,
  requirements: ClipboardList,
  synthesis: Layers,
};

function TypeIcon({ type, role }: { type: SessionNodeType['type']; role?: string }) {
  const Icon = type === 'reviewer' && role
    ? (REVIEWER_ROLE_ICON[role] ?? ShieldCheck)
    : (TYPE_ICON[type] ?? Code2);
  return <Icon size={13} className={styles.sessionTypeIcon} />;
}

function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function shortModel(model: string): string {
  return model
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '');
}

function deriveSessionLabel(session: SessionNodeType, resolvedModel?: string | null): string {
  const sessionModel = session.model && session.model !== 'unknown' && session.model !== 'specialist'
    ? shortModel(session.model)
    : '';
  const model = sessionModel || (resolvedModel ? shortModel(resolvedModel) : '');
  switch (session.type) {
    case 'merge': return model ? `Merge (${model})` : 'Merge agent';
    case 'test': return model ? `Tests (${model})` : 'Tests';
    case 'review': return model ? `Review (${model})` : 'Review';
    case 'reviewer': {
      const role = session.role ? capitalize(session.role) : 'Reviewer';
      return model ? `${role} (${model})` : role;
    }
    case 'work': return model ? `Work (${model})` : 'Work agent';
    case 'planning': return model ? `Planning (${model})` : 'Planning';
    case 'legacy': return 'Planning state';
    default: return session.type;
  }
}

function RestartModelSubmenu({
  defaultModel,
  groups,
  label,
  onRestart,
}: {
  defaultModel: string | null;
  groups: ModelGroup[];
  label?: string;
  onRestart: (model?: string) => void;
}) {
  const defaultLabel = defaultModel
    ? defaultModel.replace(/^claude-/, '').replace(/-\d{8}$/, '')
    : 'default';

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        {label ? `${label} (${defaultLabel})` : `Restart (${defaultLabel})`}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem onSelect={() => onRestart()}>
          <span className="flex-1">Default ({defaultLabel})</span>
        </ContextMenuItem>
        {groups.map((group) => (
          <div key={group.provider}>
            <ContextMenuLabel>{group.label}</ContextMenuLabel>
            {group.models.map((m) => (
              <ContextMenuItem key={m.id} onSelect={() => onRestart(m.id)}>
                <span
                  className={`flex-1 ${m.id === defaultModel ? 'font-semibold text-primary' : ''}`}
                >
                  {m.label}
                </span>
                {m.costDisplay && (
                  <span className="ml-2 shrink-0 text-[10px] opacity-50">{m.costDisplay}</span>
                )}
              </ContextMenuItem>
            ))}
          </div>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

export function SessionNode({
  session,
  issueId,
  isSelected,
  onClick,
  onStopSession,
  onViewTerminal,
  onPauseSession,
  onResumeSession,
  onRestartSession,
  onDeepWipe,
  onOpenStateDir,
  onViewJsonl,
  expandable,
  expanded,
  onToggleExpand,
}: SessionNodeProps) {
  const { groups } = useAvailableModels();
  const resolvedModels = useResolvedModels();

  const runtime = useDashboardStore((s) => s.agentRuntimeById[session.sessionId]);
  const lastActivity = runtime?.lastActivity;

  const [isStopping, setIsStopping] = useState(false);

  const dotStatus = deriveDotStatus(runtime, session.presence);
  const activity = effectiveActivity(runtime, session.presence);
  const isLive = session.presence === 'active' || session.presence === 'idle' || session.presence === 'suspended';
  const displayStatus = (isStopping && isLive) ? 'stopping' : (activity ?? session.status);
  const statusCssKey = (isStopping && isLive) ? 'stopping' : (activity ?? session.status);

  const flashKey = `${session.sessionId}:${session.presence}:${session.status}`;
  const flashClass = useLiveFlash(flashKey, 'anim-row-flash', 600);

  const canPause = session.presence === 'active' && onPauseSession;
  const canResume = session.presence === 'suspended' && onResumeSession;
  const canStop = isLive && !!onStopSession;
  const canRestart = onRestartSession && issueId != null;
  const canDeepWipe = onDeepWipe && issueId != null;
  const hasLifecycleActions = canPause || canResume || canStop || canRestart;

  const handleStop = useCallback(() => {
    setIsStopping(true);
    onStopSession!(session.sessionId);
  }, [session.sessionId, onStopSession]);

  const handleDeepWipe = useCallback(() => {
    if (!issueId || !onDeepWipe) return;
    const confirmed = window.confirm(
      `Deep wipe will destroy all data for ${issueId} including workspace, state, and git branches. This cannot be undone.\n\nAre you absolutely sure?`,
    );
    if (confirmed) {
      onDeepWipe(issueId);
    }
  }, [issueId, onDeepWipe]);

  const workTypeKey = resolveWorkTypeKey(session);
  const defaultModel = workTypeKey ? (resolvedModels[workTypeKey] ?? null) : null;
  // Use "Start" label when session has ended (agent stopped); "Restart" when live
  const restartLabel = session.type === 'review' ? 'Restart all' : !isLive ? 'Start' : undefined;

  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>
        <button
          className={`${styles.sessionNode} ${isSelected ? styles.sessionNodeSelected : ''} ${flashClass}`}
          onClick={() => onClick?.()}
        >
          {expandable && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onToggleExpand?.(); } }}
              style={{ display: 'inline-flex', flexShrink: 0, cursor: 'pointer' }}
            >
              {expanded
                ? <ChevronDown size={12} style={{ color: 'var(--muted-foreground)' }} />
                : <ChevronRight size={12} style={{ color: 'var(--muted-foreground)' }} />}
            </span>
          )}
          <ReviewerVerdict session={session} dotStatus={dotStatus} />
          <TypeIcon type={session.type} role={session.role} />
          <span
            className={styles.sessionLabel}
            title={(() => {
              if (!lastActivity) return session.sessionId;
              const ms = Date.now() - new Date(lastActivity).getTime();
              if (ms < 1000) return session.sessionId;
              return `${session.sessionId} · Last heard: ${formatRelativeTime(lastActivity, new Date())}`;
            })()}
          >
            {deriveSessionLabel(session, defaultModel)}
          </span>
          <LiveLastHeard lastActivity={lastActivity} />
          <span className={`${styles.sessionStatus} ${styles[`sessionStatus_${statusCssKey}`] ?? ''}`}>
            {displayStatus}
          </span>
          <span className={styles.sessionDuration}>{formatDuration(session.duration)}</span>
        </button>
      </ContextMenuTrigger>

      <ContextMenuContent>
        {canPause && (
          <ContextMenuItem onSelect={() => onPauseSession!(session.sessionId)}>
            Pause
          </ContextMenuItem>
        )}
        {canResume && (
          <ContextMenuItem onSelect={() => onResumeSession!(session.sessionId)}>
            Resume
          </ContextMenuItem>
        )}
        {canStop && (
          <ContextMenuItem onSelect={handleStop} disabled={isStopping}>
            {isStopping ? 'Stopping...' : 'Stop'}
          </ContextMenuItem>
        )}
        {canRestart && (
          <RestartModelSubmenu
            defaultModel={defaultModel}
            groups={groups}
            label={restartLabel}
            onRestart={(model) => onRestartSession!(session.sessionId, issueId!, session.type, session.role, model)}
          />
        )}

        {hasLifecycleActions && canDeepWipe && <ContextMenuSeparator />}

        {canDeepWipe && (
          <ContextMenuDestructiveItem onSelect={handleDeepWipe}>
            Deep Wipe
          </ContextMenuDestructiveItem>
        )}

        {(hasLifecycleActions || canDeepWipe) && (onOpenStateDir || onViewJsonl || onViewTerminal) && (
          <ContextMenuSeparator />
        )}

        {onOpenStateDir && (
          <ContextMenuItem onSelect={() => onOpenStateDir(session.sessionId)}>
            Open State Dir
          </ContextMenuItem>
        )}
        {onViewJsonl && session.hasJsonl && (
          <ContextMenuItem onSelect={() => onViewJsonl(session.sessionId)}>
            View JSONL
          </ContextMenuItem>
        )}
        {onViewTerminal && (
          <ContextMenuItem onSelect={() => onViewTerminal(session.sessionId)}>
            View Terminal
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}
