import { useCallback, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Code2,
  BookOpenCheck,
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
  Loader2,
  Terminal,
  FileText,
  Search,
  Globe,
  Bot,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useLiveFlash } from '../../lib/useLiveFlash';
import { useSharedTick } from '../../lib/useSharedTick';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { useDashboardStore } from '../../lib/store';
import { useResolvedModels, resolveWorkTypeKey } from '../../lib/useResolvedModels';
import { useAvailableModels, type Harness, type ModelGroup } from '../shared/ModelPicker';
import { StatusDot, type StatusDotStatus } from '../CommandDeck/StatusDot';
import { toolNameToPhase, isSpinnerPhase, type WorkingPhase } from '../../lib/workingPhase';
import { useIssueCostsQuery } from '../CommandDeck/ZoneCOverviewTabs/queries';
import type { SessionNode as SessionNodeType, Activity, AgentRuntimeSnapshot, ModelOrigin } from '@overdeck/contracts';
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
} from '../shared/ContextMenu';
import { AGENT_ROW_SECTIONS } from './inventory';
import railStyles from '../CommandDeck/styles/command-deck.module.css';
import cockpitStyles from '../Stage/cockpit/agentsLane.module.css';

const SECTIONS = {
  caret: AGENT_ROW_SECTIONS[0],
  icon: AGENT_ROW_SECTIONS[1],
  label: AGENT_ROW_SECTIONS[2],
  model: AGENT_ROW_SECTIONS[3],
  status: AGENT_ROW_SECTIONS[4],
  duration: AGENT_ROW_SECTIONS[5],
  cost: AGENT_ROW_SECTIONS[6],
  verdict: AGENT_ROW_SECTIONS[7],
  contextMenu: AGENT_ROW_SECTIONS[8],
  pausedReason: AGENT_ROW_SECTIONS[9],
};

export type AgentStepDensity = 'rail' | 'cockpit';

export type AgentStepActionKind =
  | 'stop'
  | 'pause'
  | 'unpause'
  | 'resume'
  | 'restart'
  | 'deep-wipe'
  | 'open-state-dir'
  | 'view-jsonl'
  | 'view-terminal';

export interface AgentStepRowProps {
  session: SessionNodeType;
  issueId?: string;
  density: AgentStepDensity;
  isSelected?: boolean;
  subtitle?: string;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onClick?: () => void;
  /** Hide the context menu (e.g. cockpit rows where handlers aren't plumbed). Defaults to true. */
  showMenu?: boolean;
  onAction: (kind: AgentStepActionKind, payload?: { model?: string; harness?: Harness }) => void;
}

const TYPE_ICON: Record<string, LucideIcon> = {
  work: Code2,
  knowledge: BookOpenCheck,
  strike: Zap,
  planning: Compass,
  review: Eye,
  test: FlaskConical,
  merge: GitMerge,
  ship: GitMerge,
  legacy: Archive,
};

const REVIEWER_ROLE_ICON: Record<string, LucideIcon> = {
  correctness: ShieldCheck,
  security: Lock,
  performance: Gauge,
  requirements: ClipboardList,
  synthesis: Layers,
};

function TypeIcon({ type, role }: { type: SessionNodeType['type']; role?: string }): JSX.Element {
  const Icon = type === 'reviewer' && role
    ? (REVIEWER_ROLE_ICON[role] ?? ShieldCheck)
    : (TYPE_ICON[type] ?? Code2);
  return <Icon size={13} />;
}

function slotIndexFromSessionId(sessionId: string): number | null {
  const match = /^agent-[a-z]+-\d+-slot-(\d+)$/i.exec(sessionId);
  if (!match) return null;
  return Number(match[1]);
}

function shortModel(model: string | undefined): string {
  return (model ?? '')
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '');
}

function deriveSessionModel(session: SessionNodeType, resolvedModel?: string | null): string {
  const sessionModel = session.model && session.model !== 'unknown' && session.model !== 'specialist'
    ? shortModel(session.model)
    : '';
  return sessionModel || (resolvedModel ? shortModel(resolvedModel) : '');
}

function deriveSessionLabel(session: SessionNodeType): string {
  const slotIndex = session.type === 'work' ? slotIndexFromSessionId(session.sessionId) : null;
  if (slotIndex !== null) return `Slot ${slotIndex}`;

  switch (session.type) {
    case 'ship': return 'Ship';
    case 'merge': return 'Merge';
    case 'test': return 'Test';
    case 'review': return 'Review';
    case 'reviewer': return session.role ? capitalize(session.role) : 'Reviewer';
    case 'work': return 'Work';
    case 'knowledge': return 'Knowledge';
    case 'strike': return 'Strike';
    case 'planning': return 'Planning';
    case 'legacy': return 'Planning state';
    default: return session.type;
  }
}

function cockpitLabel(session: SessionNodeType): string {
  switch (session.type) {
    case 'planning':
    case 'legacy': return 'Plan';
    case 'knowledge': return 'Knowledge';
    case 'work': return 'Work';
    case 'strike': return 'Strike';
    case 'review': return 'Review';
    case 'reviewer': return session.role ? capitalize(session.role) : 'Reviewer';
    case 'test': return 'Test';
    case 'ship':
    case 'merge': return 'Ship';
    default: return capitalize(session.type);
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function formatDurCockpit(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
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
  const isEnded = presence === 'ended';
  if (isEnded) return undefined;
  if (runtime.activity === 'stopped' && !isEnded) return 'idle';
  return runtime.activity;
}

function deriveDotStatus(runtime: AgentRuntimeSnapshot | undefined, presence: SessionNodeType['presence']): StatusDotStatus {
  const activity = effectiveActivity(runtime, presence);
  if (activity) return activityToStatus(activity);
  return presenceToStatus(presence);
}

const PHASE_ICON: Record<WorkingPhase, LucideIcon> = {
  init: Loader2,
  thinking: Loader2,
  bash: Terminal,
  file: FileText,
  search: Search,
  web: Globe,
  agent: Bot,
  tool: Wrench,
  processing: Loader2,
};

const PHASE_COLOR: Record<WorkingPhase, string> = {
  init: 'var(--muted-foreground)',
  thinking: 'var(--primary)',
  bash: 'var(--warning)',
  file: 'var(--success)',
  search: 'var(--info, #3b82f6)',
  web: 'var(--info, #3b82f6)',
  agent: 'var(--signal-review, #8b5cf6)',
  tool: 'var(--muted-foreground)',
  processing: 'var(--primary)',
};

function PhaseIcon({ runtime, dotStatus }: { runtime: AgentRuntimeSnapshot | undefined; dotStatus: StatusDotStatus }): JSX.Element {
  const phase = runtime?.currentTool ? toolNameToPhase(runtime.currentTool) : undefined;
  if (!phase) {
    if (dotStatus === 'active' || dotStatus === 'thinking') {
      return (
        <Loader2
          size={12}
          className="animate-spin"
          style={{ color: 'var(--primary)', flexShrink: 0 }}
        />
      );
    }
    return <StatusDot status={dotStatus} size="sm" />;
  }
  const Icon = PHASE_ICON[phase];
  const color = PHASE_COLOR[phase];
  const isSpin = isSpinnerPhase(phase);
  return (
    <Icon
      size={12}
      className={isSpin ? 'animate-spin' : undefined}
      style={{ color, flexShrink: 0 }}
    />
  );
}

function ReviewerVerdict({ session, dotStatus, runtime }: { session: SessionNodeType; dotStatus: StatusDotStatus; runtime: AgentRuntimeSnapshot | undefined }): JSX.Element | null {
  const { latestStatus, latestReviewResult } = session.roundMetadata ?? {};
  if (latestReviewResult === 'APPROVED') {
    return <CircleCheck size={10} style={{ color: 'var(--success)', flexShrink: 0 }} />;
  }
  if (latestReviewResult === 'CHANGES_REQUESTED' || latestStatus === 'failed') {
    return <CircleX size={10} style={{ color: 'var(--destructive)', flexShrink: 0 }} />;
  }
  if (session.type !== 'reviewer') return null;
  return <PhaseIcon runtime={runtime} dotStatus={dotStatus} />;
}

function useSessionCost(issueId: string | undefined): (session: SessionNodeType) => string | undefined {
  const costs = useIssueCostsQuery(issueId ?? '');
  const sessions = costs.data?.sessions ?? [];
  return useCallback((session: SessionNodeType) => {
    const hit = sessions.find((entry) =>
      entry.sessionId === session.sessionId
      || (entry.agentId && (entry.agentId === session.tmuxSession || entry.agentId === session.sessionId)));
    if (!hit?.cost || hit.cost <= 0) return undefined;
    const tokens = hit.tokenCount && hit.tokenCount > 0
      ? ` · ${hit.tokenCount >= 1_000_000 ? `${(hit.tokenCount / 1_000_000).toFixed(1)}M` : `${Math.round(hit.tokenCount / 1_000)}k`} tok`
      : '';
    return `$${hit.cost.toFixed(2)}${tokens}`;
  }, [sessions]);
}

function describeWaitingReason(runtime: AgentRuntimeSnapshot | undefined): string {
  switch (runtime?.waiting?.reason) {
    case 'tool_permission': return 'Waiting for tool permission approval.';
    case 'user_question': return 'Waiting for your reply before continuing.';
    case 'disambiguation': return 'Waiting for clarification before continuing.';
    case 'other': return 'Waiting for external input before continuing.';
    default: return 'Waiting for input before continuing.';
  }
}

function describeSessionPurpose(session: SessionNodeType): string {
  const slotIndex = session.type === 'work' ? slotIndexFromSessionId(session.sessionId) : null;
  if (slotIndex !== null) {
    return `Registered swarm slot ${slotIndex} for this issue.`;
  }

  switch (session.type) {
    case 'work': return 'Implementation agent for this issue.';
    case 'knowledge': return 'Knowledge agent maintaining the OKF bundle for this issue.';
    case 'strike': return 'Drop-in implement-and-merge agent for this issue.';
    case 'planning': return 'Planning and context-building session for this issue.';
    case 'review': return 'Review coordinator for this issue.';
    case 'reviewer':
      return session.role
        ? `${capitalize(session.role)} specialist reviewer in the review pipeline.`
        : 'Specialist reviewer in the review pipeline.';
    case 'test': return 'Verification and test session for this issue.';
    case 'ship': return 'Ship agent — rebases, verifies, and pushes the branch for merge.';
    case 'merge': return 'Merge and close-out session for this issue.';
    case 'legacy': return 'Saved planning state for this issue.';
    default: return 'Session for this issue.';
  }
}

function describePresence(presence: SessionNodeType['presence']): string {
  switch (presence) {
    case 'active': return 'tmux session is live.';
    case 'idle': return 'tmux session is still live.';
    case 'suspended': return 'Session is suspended and can be resumed.';
    case 'ended': return 'Session has ended.';
    default: return 'Session presence is unknown.';
  }
}

function getSessionLabelTitle(
  session: SessionNodeType,
  resolvedModel: string | null,
  lastHeardLabel?: string,
): string {
  const details = [describeSessionPurpose(session)];
  const model = deriveSessionModel(session, resolvedModel);
  if (model) details.push(`Model: ${model}.`);
  details.push(`Session: ${session.sessionId}.`);
  if (lastHeardLabel) details.push(`Last heard: ${lastHeardLabel}.`);
  return details.join(' ');
}

function getSessionStatusTitle({
  runtime,
  presence,
  displayStatus,
  lastHeardLabel,
}: {
  runtime: AgentRuntimeSnapshot | undefined;
  presence: SessionNodeType['presence'];
  displayStatus: string;
  lastHeardLabel?: string;
}): string {
  const details: string[] = [];
  switch (displayStatus) {
    case 'working': details.push('Actively using tools or just finished a tool run.'); break;
    case 'thinking': details.push('Waiting on model output with no tool currently in flight.'); break;
    case 'waiting': details.push(describeWaitingReason(runtime)); break;
    case 'idle':
      details.push('Session is live but idle, waiting for the next turn.');
      if (runtime?.activity === 'stopped' && presence !== 'ended') {
        details.push('The agent has stopped working, but the tmux session is still alive.');
      }
      break;
    case 'starting':
      details.push(
        presence === 'ended'
          ? 'Session was starting, but it appears to have ended before reporting live activity.'
          : 'Session is starting and has not reported live activity yet.',
      );
      break;
    case 'running':
      details.push(
        presence === 'ended'
          ? 'Session still reports a running state, but its tmux session has ended.'
          : 'Session is running but has not reported a more specific live activity yet.',
      );
      break;
    case 'error':
      details.push(
        presence === 'ended'
          ? 'Session hit an error and has ended.'
          : 'Session hit an error and needs attention before work can continue.',
      );
      break;
    case 'stopped':
      details.push(
        presence === 'ended'
          ? 'Session ended cleanly and is no longer live.'
          : 'Agent work is stopped, but the tmux session is still live.',
      );
      break;
    case 'stopping': details.push('Stop has been requested and the session is shutting down.'); break;
    default: details.push(`Session status: ${displayStatus}.`); break;
  }

  const includePresenceDetail = !(
    presence === 'ended'
    && (displayStatus === 'starting' || displayStatus === 'running' || displayStatus === 'error' || displayStatus === 'stopped')
  );
  if (includePresenceDetail) {
    details.push(describePresence(presence));
  }

  if (displayStatus === 'working' && runtime?.currentTool) details.push(`Current tool: ${runtime.currentTool}.`);
  if (displayStatus === 'waiting' && runtime?.waiting?.message) details.push(`Waiting on: ${runtime.waiting.message}.`);
  if (lastHeardLabel) details.push(`Last heard: ${lastHeardLabel}.`);
  return details.join(' ');
}

function ModelOriginPanel({
  origin,
  resolvedModel,
  roleLabel,
  currentHarness,
}: {
  origin?: ModelOrigin;
  resolvedModel?: string | null;
  roleLabel: string;
  currentHarness?: string | null;
}): JSX.Element {
  const resolved = origin?.resolved ?? resolvedModel ?? 'unknown';
  const positive = origin ? origin.distribution.filter((d) => d.weight > 0) : [];
  const chosenBand = origin?.distribution.find((d) => d.chosen);
  const total = origin?.total ?? 0;

  const bar = (d: ModelOrigin['distribution'][number]) => {
    const pct = total > 0 ? Math.round((d.weight / total) * 100) : 0;
    const highlight = d.model === resolved;
    return (
      <div key={d.model} className="flex items-center gap-2">
        <span className={`w-[108px] shrink-0 truncate font-mono text-[10px] ${highlight ? 'text-foreground' : 'text-muted-foreground'}`}>
          {d.model}
        </span>
        <span className="h-1 flex-1 overflow-hidden rounded-sm bg-foreground/10">
          <span className={`block h-full rounded-sm ${highlight ? 'bg-foreground/45' : 'bg-foreground/20'}`} style={{ width: `${pct}%` }} />
        </span>
        <span className="w-7 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">{pct}%</span>
      </div>
    );
  };

  return (
    <div className="mx-1 mb-1 mt-0.5 rounded-md border border-border bg-foreground/[0.03] px-2.5 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {origin ? 'Resolves to' : 'Model'}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="truncate font-mono text-xs text-foreground">{resolved}</span>
        {!origin && currentHarness ? (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">· {currentHarness}</span>
        ) : null}
      </div>
      {!origin ? (
        <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          Fixed <span className="font-mono">{roleLabel}</span> role model — no distribution. Add
          model percentages in Settings → Roles to spread across providers.
        </div>
      ) : (
        <>
          <div className="mt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {roleLabel} distribution
          </div>
          <div className="mt-1.5 space-y-1.5">{positive.map((d) => bar(d))}</div>
          {chosenBand ? (
            <div className="mt-2 rounded-sm bg-foreground/[0.04] px-1.5 py-1 font-mono text-[10px] leading-snug text-muted-foreground">
              hash(&quot;{origin.spawnKey}&quot;) → bucket {origin.bucket} of {origin.total} → <span className="text-foreground">{origin.resolved}</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function RestartModelSubmenu({
  defaultModel,
  currentHarness,
  currentModel,
  groups,
  label,
  onRestart,
  modelOrigin,
  roleLabel,
}: {
  defaultModel: string | null;
  currentHarness?: string | null;
  currentModel?: string | null;
  groups: ModelGroup[];
  label?: string;
  onRestart: (model?: string, harness?: Harness) => void;
  modelOrigin?: ModelOrigin;
  roleLabel?: string;
}): JSX.Element {
  const defaultPick = modelOrigin?.resolved ?? defaultModel;
  const defaultLabel = defaultPick
    ? defaultPick.replace(/^claude-/, '').replace(/-\d{8}$/, '')
    : 'default';

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{label ?? 'Restart'}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ModelOriginPanel
          origin={modelOrigin}
          resolvedModel={currentModel}
          roleLabel={roleLabel ?? 'role'}
          currentHarness={currentHarness}
        />
        <ContextMenuItem onSelect={() => onRestart()}>
          <span className="flex-1">Default role config</span>
          <span className="ml-2 shrink-0 text-[10px] opacity-50">uses {defaultLabel}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {groups.map((group) => (
          <div key={group.provider}>
            <ContextMenuLabel>{group.label}</ContextMenuLabel>
            {group.models.map((m) => (
              <ContextMenuItem key={m.id} onSelect={() => onRestart(m.id)}>
                <span className={`flex-1 ${m.id === defaultPick ? 'text-foreground' : ''}`}>{m.label}</span>
                {m.costDisplay && <span className="ml-2 shrink-0 text-[10px] opacity-50">{m.costDisplay}</span>}
              </ContextMenuItem>
            ))}
          </div>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

export function AgentStepRow({
  session,
  issueId,
  density,
  isSelected,
  subtitle,
  expandable,
  expanded,
  onToggleExpand,
  onClick,
  onAction,
  showMenu = true,
}: AgentStepRowProps): JSX.Element {
  const { groups } = useAvailableModels();
  const resolvedModels = useResolvedModels();
  const costOf = useSessionCost(issueId);
  const runtime = useDashboardStore((s) => s.agentRuntimeById[session.sessionId]);
  const lastActivity = runtime?.lastActivity;
  const [isStopping, setIsStopping] = useState(false);

  const isPaused = session.paused === true;
  const dotStatus = isPaused ? 'waiting' : session.awaitingInput ? 'waiting' : deriveDotStatus(runtime, session.presence);
  const activity = effectiveActivity(runtime, session.presence);
  const isLive = session.presence === 'active' || session.presence === 'idle' || session.presence === 'suspended';
  const displayStatus = (isStopping && isLive) ? 'stopping' : isPaused ? 'paused' : session.awaitingInput ? 'waiting' : (activity ?? session.status);
  const statusCssKey = (isStopping && isLive) ? 'stopping' : isPaused ? 'paused' : session.awaitingInput ? 'waiting' : (activity ?? session.status);

  const isLiveActivity = isLive && !isPaused && (
    statusCssKey === 'running' || statusCssKey === 'working' || statusCssKey === 'thinking' || statusCssKey === 'starting'
  );

  const workTypeKey = resolveWorkTypeKey(session);
  const defaultModel = workTypeKey ? (resolvedModels[workTypeKey] ?? null) : null;
  const sessionModel = deriveSessionModel(session, defaultModel);
  const sessionLabel = density === 'cockpit' ? cockpitLabel(session) : deriveSessionLabel(session);
  const cost = costOf(session);

  const canPause = session.presence === 'active' && density === 'rail';
  const canResume = session.presence === 'suspended';
  const canResumeStopped = !isLive;
  const canStop = isLive;
  const canRestart = issueId != null;
  const canDeepWipe = issueId != null;
  const hasLifecycleActions = canPause || canResume || canStop || canRestart || canResumeStopped;
  const hasUtilityActions = true;

  const handleStop = useCallback(() => {
    setIsStopping(true);
    onAction('stop');
  }, [onAction]);

  const handleDeepWipe = useCallback(() => {
    if (!issueId) return;
    const confirmed = window.confirm(
      `Deep wipe will destroy all data for ${issueId} including workspace, state, and git branches. This cannot be undone.\n\nAre you absolutely sure?`,
    );
    if (confirmed) onAction('deep-wipe');
  }, [issueId, onAction]);

  const restartLabel = session.type === 'review' || session.type === 'reviewer'
    ? 'Re-run review on latest commit'
    : !isLive ? 'Start' : undefined;

  const lastHeardLabel = lastActivity ? formatRelativeTime(lastActivity, new Date()) : undefined;
  const sessionLabelTitle = getSessionLabelTitle(session, defaultModel, lastHeardLabel);
  const statusTitle = isPaused
    ? `Paused${session.pausedReason ? `: ${session.pausedReason}` : ''}`
    : session.awaitingInput
      ? `Awaiting user input${session.awaitingInputPrompt ? `: ${session.awaitingInputPrompt}` : '.'}`
      : getSessionStatusTitle({ runtime, presence: session.presence, displayStatus, lastHeardLabel });

  const flashKey = `${session.sessionId}:${session.presence}:${session.status}`;
  const flashClass = useLiveFlash(flashKey, 'anim-row-flash', 600);

  const railIconClass = isPaused
    ? railStyles.sessionIconPaused
    : statusCssKey === 'error'
      ? railStyles.sessionIconError
      : isLiveActivity
        ? (session.type === 'review' || session.type === 'reviewer' ? railStyles.sessionIconReview : railStyles.sessionIconRunning)
        : '';

  const { latestReviewResult } = session.roundMetadata ?? {};
  const verdictTile = latestReviewResult === 'APPROVED' ? 'ok' : latestReviewResult === 'CHANGES_REQUESTED' ? 'bad' : undefined;

  const renderCockpitTile = () => {
    if (verdictTile) {
      return (
        <span className={`${cockpitStyles.tile} ${cockpitStyles[verdictTile]}`} data-section={SECTIONS.verdict}>
          {verdictTile === 'ok' ? <CircleCheck size={11} /> : <CircleX size={11} />}
        </span>
      );
    }
    const tileClass = session.type === 'work' || session.type === 'strike'
      ? cockpitStyles.work
      : session.type === 'review' || session.type === 'reviewer'
        ? cockpitStyles.review
        : session.type === 'test'
          ? cockpitStyles.ver
          : '';
    const active = isLiveActivity;
    return (
      <span className={`${cockpitStyles.tile} ${tileClass}`} data-section={SECTIONS.icon}>
        {active ? (
          <Loader2 size={11} className={cockpitStyles.spin} style={{ color: 'var(--info)' }} />
        ) : (
          <TypeIcon type={session.type} role={session.role} />
        )}
      </span>
    );
  };

  const renderRailIcon = () => (
    <span className={`${railStyles.sessionIconSlot} ${railIconClass}`} data-section={SECTIONS.icon} title={sessionLabelTitle}>
      <TypeIcon type={session.type} role={session.role} />
    </span>
  );

  const statusClassForCockpit =
    statusCssKey === 'running' || statusCssKey === 'working' || statusCssKey === 'thinking' || statusCssKey === 'starting'
      ? 'info'
      : statusCssKey === 'error'
        ? 'bad'
        : 'muted';

  const renderContextMenu = () => (
    <ContextMenuContent data-section={SECTIONS.contextMenu}>
      {canPause && (
        <ContextMenuItem onSelect={() => onAction('pause')}>Pause</ContextMenuItem>
      )}
      {canResume && (
        <ContextMenuItem onSelect={() => onAction('resume')}>Resume</ContextMenuItem>
      )}
      {canResumeStopped && (
        <ContextMenuItem onSelect={() => onAction('resume')}>Resume session</ContextMenuItem>
      )}
      {isPaused && (
        <ContextMenuItem onSelect={() => onAction('unpause')}>Unpause</ContextMenuItem>
      )}
      {canStop && (
        <ContextMenuItem onSelect={handleStop} disabled={isStopping}>
          {isStopping ? 'Stopping...' : 'Stop'}
        </ContextMenuItem>
      )}
      {canRestart && (
        <RestartModelSubmenu
          defaultModel={defaultModel}
          currentHarness={session.harness ?? null}
          currentModel={session.model}
          groups={groups}
          label={restartLabel}
          modelOrigin={session.modelOrigin}
          roleLabel={session.role ?? session.type}
          onRestart={(model, harness) => onAction('restart', { model, harness })}
        />
      )}

      {hasLifecycleActions && canDeepWipe && <ContextMenuSeparator />}

      {canDeepWipe && (
        <ContextMenuDestructiveItem onSelect={handleDeepWipe}>Deep Wipe</ContextMenuDestructiveItem>
      )}

      {(hasLifecycleActions || canDeepWipe) && hasUtilityActions && <ContextMenuSeparator />}

      <ContextMenuItem onSelect={() => onAction('open-state-dir')}>Open State Dir</ContextMenuItem>
      {session.hasJsonl && (
        <ContextMenuItem onSelect={() => onAction('view-jsonl')}>View JSONL</ContextMenuItem>
      )}
      <ContextMenuItem onSelect={() => onAction('view-terminal')}>View Terminal</ContextMenuItem>
    </ContextMenuContent>
  );

  if (density === 'cockpit') {
    const subParts = [formatDurCockpit(session.duration), cost].filter(Boolean);
    const cockpitButton = (
      <button
        type="button"
        className={`${cockpitStyles.row} ${isSelected ? cockpitStyles.sel : ''}`}
        onClick={() => onClick?.()}
      >
        <span className={cockpitStyles.caret} data-section={SECTIONS.caret}>
          {expandable && (
            <span
              role="button"
              tabIndex={-1}
              className={cockpitStyles.caretBtn}
              onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
            >
              {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </span>
          )}
        </span>
        {renderCockpitTile()}
        <span className={cockpitStyles.body}>
          <span className={cockpitStyles.l1}>
            <span className={cockpitStyles.name} data-section={SECTIONS.label}>{sessionLabel}</span>
            <span className={`${cockpitStyles.status} ${cockpitStyles[statusClassForCockpit]}`} data-section={SECTIONS.status}>
              {isLiveActivity ? <Loader2 size={9} className={cockpitStyles.spin} /> : null}
              {displayStatus}
            </span>
          </span>
          {(sessionModel || subParts.length > 0) && (
            <span className={cockpitStyles.l2}>
              {sessionModel && (
                <span className={cockpitStyles.model} data-section={SECTIONS.model}>{sessionModel}</span>
              )}
              {subParts.length > 0 && (
                <span className={cockpitStyles.sub} data-section={SECTIONS.duration}>{subParts.join(' · ')}</span>
              )}
            </span>
          )}
        </span>
      </button>
    );

    if (!showMenu) return cockpitButton;

    return (
      <ContextMenuRoot>
        <ContextMenuTrigger asChild>
          {cockpitButton}
        </ContextMenuTrigger>
        {renderContextMenu()}
      </ContextMenuRoot>
    );
  }

  // rail density
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>
        <button
          className={`${railStyles.sessionNode} ${isSelected ? railStyles.sessionNodeSelected : ''} ${flashClass}`}
          onClick={() => onClick?.()}
          onDoubleClick={() => {
            if (session.type === 'planning' && issueId) {
              onAction('open-state-dir');
            }
          }}
        >
          <span className={railStyles.sessionToggleSlot} data-section={SECTIONS.caret}>
            {expandable && (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onToggleExpand?.(); } }}
                className={railStyles.sessionToggleButton}
              >
                {expanded
                  ? <ChevronDown size={12} style={{ color: 'var(--muted-foreground)' }} />
                  : <ChevronRight size={12} style={{ color: 'var(--muted-foreground)' }} />}
              </span>
            )}
          </span>
          <span className={railStyles.sessionDotSlot} data-section={SECTIONS.verdict}>
            <ReviewerVerdict session={session} dotStatus={dotStatus} runtime={runtime} />
          </span>
          {renderRailIcon()}
          <span className={railStyles.sessionLabel} data-section={SECTIONS.label} title={sessionLabelTitle}>
            {sessionLabel}
          </span>
          {sessionModel && (
            <span className={railStyles.sessionModel} data-section={SECTIONS.model} title={sessionLabelTitle}>
              {sessionModel}
            </span>
          )}
          {subtitle && (
            <span className={railStyles.sessionSubtitle}>{subtitle}</span>
          )}
          <LiveLastHeard lastActivity={lastActivity} />
          {!['stopped', 'unknown', 'idle', 'completed', 'running', 'working', 'thinking', 'paused'].includes(String(statusCssKey)) && (
            <span
              className={`${railStyles.sessionStatus} ${railStyles[`sessionStatus_${statusCssKey}`] ?? ''}`}
              data-section={SECTIONS.status}
              title={statusTitle}
            >
              {displayStatus}
            </span>
          )}
          {isPaused && (
            <span
              role="button"
              tabIndex={-1}
              data-testid="session-unpause"
              className={railStyles.unpauseBtn}
              title={session.pausedReason ? `Unpause — paused: ${session.pausedReason}` : 'Unpause this agent'}
              onClick={(e) => { e.stopPropagation(); onAction('unpause'); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onAction('unpause'); } }}
            >
              ▶ Unpause
            </span>
          )}
          {cost && (
            <span className={railStyles.sessionDuration} data-section={SECTIONS.cost}>{cost}</span>
          )}
          {!cost && isLive && session.duration != null && session.duration > 0 && (
            <span className={railStyles.sessionDuration} data-section={SECTIONS.duration}>{formatDuration(session.duration)}</span>
          )}
        </button>
      </ContextMenuTrigger>
      {isPaused && session.pausedReason && (
        <div className={railStyles.sessionPausedReason} data-section={SECTIONS.pausedReason} data-testid="session-paused-reason" title={session.pausedReason}>
          ⏸ {session.pausedReason}
        </div>
      )}
      {showMenu && renderContextMenu()}
    </ContextMenuRoot>
  );
}

function LiveLastHeard({ lastActivity }: { lastActivity?: string }): JSX.Element | null {
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

function stalenessColor(ms: number): string {
  if (ms < 2 * 60_000) return 'var(--success)';
  if (ms < 10 * 60_000) return 'var(--warning)';
  if (ms < 30 * 60_000) return 'var(--orange, #f97316)';
  return 'var(--destructive)';
}
