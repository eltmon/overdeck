import { useState, useCallback, useEffect } from 'react';
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
import type { SessionNode as SessionNodeType } from '@panctl/contracts';
import { StatusDot, type StatusDotStatus } from '../StatusDot';
import { useAvailableModels, type ModelGroup } from '../../shared/ModelPicker/ModelPicker';
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

let resolvedModelsCache: Record<string, string | null> | null = null;
let resolvedModelsFetchPromise: Promise<Record<string, string | null>> | null = null;

function useResolvedModels(): Record<string, string | null> {
  const [models, setModels] = useState<Record<string, string | null>>(resolvedModelsCache ?? {});

  useEffect(() => {
    if (resolvedModelsCache) {
      setModels(resolvedModelsCache);
      return;
    }
    if (!resolvedModelsFetchPromise) {
      resolvedModelsFetchPromise = fetch('/api/models/resolve')
        .then(r => r.json())
        .then((data: Record<string, string | null>) => {
          resolvedModelsCache = data;
          return data;
        })
        .catch(() => ({}));
    }
    resolvedModelsFetchPromise.then(data => setModels(data)).catch(() => {});
  }, []);

  return models;
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

function ReviewerVerdict({ session }: { session: SessionNodeType }) {
  const { latestStatus, latestReviewResult } = session.roundMetadata ?? {};
  if (latestReviewResult === 'APPROVED') {
    return <CircleCheck size={10} style={{ color: 'var(--success)', flexShrink: 0 }} />;
  }
  if (latestReviewResult === 'CHANGES_REQUESTED' || latestStatus === 'failed') {
    return <CircleX size={10} style={{ color: 'var(--destructive)', flexShrink: 0 }} />;
  }
  return <StatusDot status={presenceToStatus(session.presence)} size="sm" />;
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

function deriveSessionLabel(session: SessionNodeType): string {
  const model = session.model && session.model !== 'unknown' && session.model !== 'specialist'
    ? shortModel(session.model)
    : '';
  switch (session.type) {
    case 'merge': return model ? `Merge (${model})` : 'Merge agent';
    case 'test': return model ? `Tests (${model})` : 'Tests';
    case 'review': return model ? `Review (${model})` : 'Review';
    case 'reviewer': return model ? model : (session.role ? capitalize(session.role) : 'Reviewer');
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

  const flashKey = `${session.sessionId}:${session.presence}:${session.status}`;
  const flashClass = useLiveFlash(flashKey, 'anim-row-flash', 600);

  const canPause = session.presence === 'active' && onPauseSession;
  const canResume = session.presence === 'suspended' && onResumeSession;
  const canStop = (session.presence === 'active' || session.presence === 'idle' || session.presence === 'suspended') && onStopSession;
  const canRestart = onRestartSession && issueId != null;
  const canDeepWipe = onDeepWipe && issueId != null;
  const hasLifecycleActions = canPause || canResume || canStop || canRestart;

  const handleDeepWipe = useCallback(() => {
    if (!issueId || !onDeepWipe) return;
    const confirmed = window.confirm(
      `Deep wipe will destroy all data for ${issueId} including workspace, state, and git branches. This cannot be undone.\n\nAre you absolutely sure?`,
    );
    if (confirmed) {
      onDeepWipe(issueId);
    }
  }, [issueId, onDeepWipe]);

  const workTypeKey = session.type === 'review' ? 'specialist-review-agent'
    : session.type === 'reviewer' && session.role ? `review:${session.role}`
    : session.type === 'work' ? 'issue-agent:implementation'
    : session.type === 'planning' ? 'planning-agent'
    : session.type === 'test' ? 'specialist-test-agent'
    : session.type === 'merge' ? 'specialist-merge-agent'
    : null;
  const defaultModel = workTypeKey ? (resolvedModels[workTypeKey] ?? null) : null;
  const restartLabel = session.type === 'review' ? 'Restart all' : undefined;

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
          <ReviewerVerdict session={session} />
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
            {deriveSessionLabel(session)}
          </span>
          <LiveLastHeard lastActivity={lastActivity} />
          <span className={`${styles.sessionStatus} ${styles[`sessionStatus_${session.status}`] ?? ''}`}>
            {session.status}
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
          <ContextMenuItem onSelect={() => onStopSession!(session.sessionId)}>
            Stop
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
