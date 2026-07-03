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
import { useLiveFlash } from '../../../lib/useLiveFlash';
import type { SessionNode as SessionNodeType, Activity, AgentRuntimeSnapshot, ModelOrigin } from '@overdeck/contracts';
import { StatusDot, type StatusDotStatus } from '../StatusDot';
import { useAvailableModels, type Harness, type HarnessPolicyDecisions, type ModelGroup } from '../../shared/ModelPicker/ModelPicker';
import { useResolvedModels, resolveWorkTypeKey } from '../../../lib/useResolvedModels';
import { useDashboardStore } from '../../../lib/store';
import { useSharedTick } from '../../../lib/useSharedTick';
import { toolNameToPhase, isSpinnerPhase, type WorkingPhase } from '../../../lib/workingPhase';
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

function PhaseIcon({ runtime, dotStatus }: { runtime: AgentRuntimeSnapshot | undefined; dotStatus: StatusDotStatus }) {
  const phase = runtime?.currentTool ? toolNameToPhase(runtime.currentTool) : undefined;
  if (!phase) {
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

function ReviewerVerdict({ session, dotStatus, runtime }: { session: SessionNodeType; dotStatus: StatusDotStatus; runtime: AgentRuntimeSnapshot | undefined }) {
  const { latestStatus, latestReviewResult } = session.roundMetadata ?? {};
  if (latestReviewResult === 'APPROVED') {
    return <CircleCheck size={10} style={{ color: 'var(--success)', flexShrink: 0 }} />;
  }
  if (latestReviewResult === 'CHANGES_REQUESTED' || latestStatus === 'failed') {
    return <CircleX size={10} style={{ color: 'var(--destructive)', flexShrink: 0 }} />;
  }
  // Redesign (PAN-1779): no per-row status dots — the icon tile carries
  // state. Reviewer verdict glyphs above are the only dot-slot content.
  if (session.type !== 'reviewer') return null;
  return <PhaseIcon runtime={runtime} dotStatus={dotStatus} />;
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
  /** PAN-1779: clear a persistent pause gate (POST /api/agents/:id/unpause). */
  onUnpauseSession?: (sessionId: string) => void;
  /** Muted summary text after the label (e.g. collapsed convoy verdict). */
  subtitle?: string;
  onRestartSession?: (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string, harness?: Harness) => void;
  onDeepWipe?: (issueId: string) => void;
  onOpenStateDir?: (sessionId: string) => void;
  onViewJsonl?: (sessionId: string) => void;
  onOpenPlanDialog?: (issueId: string) => void;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

const TYPE_ICON: Record<string, LucideIcon> = {
  work: Code2,
  strike: Zap,
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
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
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

function deriveSessionModel(session: SessionNodeType, resolvedModel?: string | null): string {
  const sessionModel = session.model && session.model !== 'unknown' && session.model !== 'specialist'
    ? shortModel(session.model)
    : '';
  return sessionModel || (resolvedModel ? shortModel(resolvedModel) : '');
}

function slotIndexFromSessionId(sessionId: string): number | null {
  const match = /^agent-[a-z]+-\d+-slot-(\d+)$/i.exec(sessionId);
  if (!match) return null;
  return Number(match[1]);
}

function deriveSessionLabel(session: SessionNodeType, _resolvedModel?: string | null): string {
  // Redesign (PAN-1779): bare role names — the model renders as its own
  // dimmed mono span, never '(model)' inside the label.
  const slotIndex = session.type === 'work' ? slotIndexFromSessionId(session.sessionId) : null;
  if (slotIndex !== null) return `Slot ${slotIndex}`;

  switch (session.type) {
    case 'ship': return 'Ship';
    case 'merge': return 'Merge';
    case 'test': return 'Test';
    case 'review': return 'Review';
    case 'reviewer': return session.role ? capitalize(session.role) : 'Reviewer';
    case 'work': return 'Work';
    case 'strike': return 'Strike';
    case 'planning': return 'Planning';
    case 'legacy': return 'Planning state';
    default: return session.type;
  }
}

function describeSessionPurpose(session: SessionNodeType): string {
  const slotIndex = session.type === 'work' ? slotIndexFromSessionId(session.sessionId) : null;
  if (slotIndex !== null) {
    return `Registered swarm slot ${slotIndex} for this issue.`;
  }

  switch (session.type) {
    case 'work':
      return 'Implementation agent for this issue.';
    case 'strike':
      return 'Drop-in implement-and-merge agent for this issue.';
    case 'planning':
      return 'Planning and context-building session for this issue.';
    case 'review':
      return 'Review coordinator for this issue.';
    case 'reviewer':
      return session.role
        ? `${capitalize(session.role)} specialist reviewer in the review pipeline.`
        : 'Specialist reviewer in the review pipeline.';
    case 'test':
      return 'Verification and test session for this issue.';
    case 'ship':
      return 'Ship agent — rebases, verifies, and pushes the branch for merge.';
    case 'merge':
      return 'Merge and close-out session for this issue.';
    case 'legacy':
      return 'Saved planning state for this issue.';
    default:
      return 'Session for this issue.';
  }
}

function describePresence(presence: SessionNodeType['presence']): string {
  switch (presence) {
    case 'active':
      return 'tmux session is live.';
    case 'idle':
      return 'tmux session is still live.';
    case 'suspended':
      return 'Session is suspended and can be resumed.';
    case 'ended':
      return 'Session has ended.';
    default:
      return 'Session presence is unknown.';
  }
}

function describeWaitingReason(runtime: AgentRuntimeSnapshot | undefined): string {
  switch (runtime?.waiting?.reason) {
    case 'tool_permission':
      return 'Waiting for tool permission approval.';
    case 'user_question':
      return 'Waiting for your reply before continuing.';
    case 'disambiguation':
      return 'Waiting for clarification before continuing.';
    case 'other':
      return 'Waiting for external input before continuing.';
    default:
      return 'Waiting for input before continuing.';
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
    case 'working':
      details.push('Actively using tools or just finished a tool run.');
      break;
    case 'thinking':
      details.push('Waiting on model output with no tool currently in flight.');
      break;
    case 'waiting':
      details.push(describeWaitingReason(runtime));
      break;
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
    case 'stopping':
      details.push('Stop has been requested and the session is shutting down.');
      break;
    default:
      details.push(`Session status: ${displayStatus}.`);
      break;
  }

  const includePresenceDetail = !(
    presence === 'ended'
    && (displayStatus === 'starting' || displayStatus === 'running' || displayStatus === 'error' || displayStatus === 'stopped')
  );

  if (includePresenceDetail) {
    details.push(describePresence(presence));
  }

  if (displayStatus === 'working' && runtime?.currentTool) {
    details.push(`Current tool: ${runtime.currentTool}.`);
  }

  if (displayStatus === 'waiting' && runtime?.waiting?.message) {
    details.push(`Waiting on: ${runtime.waiting.message}.`);
  }

  if (lastHeardLabel) {
    details.push(`Last heard: ${lastHeardLabel}.`);
  }

  return details.join(' ');
}

/**
 * PAN-2053: read-only model header for the Start/Restart submenu, in place of the
 * bare `Currently: …` label. The headline is the model a `pan start` for this issue
 * would DETERMINISTICALLY select right now — for a weighted role, the FNV-1a pick
 * from the distribution (`origin.resolved`); for a scalar role, the fixed model.
 * It is NOT the model the (possibly stale) running agent happens to be on.
 * Monochrome per the dashboard style guide; read-only — nothing here mutates.
 */
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
}) {
  // The deterministic selection for this issue's spawn key (what a restart picks).
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
  harnessPolicy?: HarnessPolicyDecisions;
  label?: string;
  onRestart: (model?: string, harness?: Harness) => void;
  modelOrigin?: ModelOrigin;
  roleLabel?: string;
}) {
  // "Default role config" restarts with NO model override, so the server re-runs
  // the weighted pick for this issue's key — i.e. modelOrigin.resolved. Show that,
  // not the representative model, so the label matches what the restart actually does.
  const defaultPick = modelOrigin?.resolved ?? defaultModel;
  const defaultLabel = defaultPick
    ? defaultPick.replace(/^claude-/, '').replace(/-\d{8}$/, '')
    : 'default';

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{label ?? 'Restart'}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {/* PAN-2053: read-only MODEL header — weight bars + FNV-1a derivation for
            weighted roles, resolved model + "no distribution" note for scalar roles.
            Replaces the old bare "Currently: …" label (PAN-1985). */}
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
        {/* Provider-default-only (PAN-1984): the operator picks a MODEL; the harness is
            derived from the model's provider server-side. No harness layer. */}
        {groups.map((group) => (
          <div key={group.provider}>
            <ContextMenuLabel>{group.label}</ContextMenuLabel>
            {group.models.map((m) => (
              <ContextMenuItem
                key={m.id}
                onSelect={() => onRestart(m.id)}
              >
                <span
                  className={`flex-1 ${m.id === defaultPick ? 'text-foreground' : ''}`}
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
  onUnpauseSession,
  subtitle,
  onRestartSession,
  onDeepWipe,
  onOpenStateDir,
  onViewJsonl,
  onOpenPlanDialog,
  expandable,
  expanded,
  onToggleExpand,
}: SessionNodeProps) {
  const { groups, harnessPolicy } = useAvailableModels();
  const resolvedModels = useResolvedModels();

  const runtime = useDashboardStore((s) => s.agentRuntimeById[session.sessionId]);
  const lastActivity = runtime?.lastActivity;

  const [isStopping, setIsStopping] = useState(false);

  // PAN-1779: a pause gate beats every other presentation — a paused agent is
  // deliberately parked (deacon will not auto-resume it), never just "stopped".
  const isPaused = session.paused === true;
  const dotStatus = isPaused ? 'waiting' : session.awaitingInput ? 'waiting' : deriveDotStatus(runtime, session.presence);
  const activity = effectiveActivity(runtime, session.presence);
  const isLive = session.presence === 'active' || session.presence === 'idle' || session.presence === 'suspended';
  const displayStatus = (isStopping && isLive) ? 'stopping' : isPaused ? 'paused' : session.awaitingInput ? 'waiting' : (activity ?? session.status);
  const statusCssKey = (isStopping && isLive) ? 'stopping' : isPaused ? 'paused' : session.awaitingInput ? 'waiting' : (activity ?? session.status);

  const flashKey = `${session.sessionId}:${session.presence}:${session.status}`;
  const flashClass = useLiveFlash(flashKey, 'anim-row-flash', 600);

  const canPause = session.presence === 'active' && onPauseSession;
  const canResume = session.presence === 'suspended' && onResumeSession;
  // PAN-1985 follow-up: any non-live session with a saved tmux + state can
  // be re-engaged by sending a continue message. Covers BOTH:
  //   - stopped work agents (status='stopped', presence='ended')
  //   - completed reviews/tests/etc. where status is still 'running' but
  //     the tmux was killed by specialists/done (PAN-846) so the agent is
  //     effectively dead — presence='ended' catches that case.
  // The backend /api/agents/:id/resume auto-resumes via the saved session
  // id (PAN-367 / PAN-705) regardless of role.
  const canResumeStopped = !isLive && onResumeSession;
  const canStop = isLive && !!onStopSession;
  const canRestart = onRestartSession && issueId != null;
  const canDeepWipe = onDeepWipe && issueId != null;
  const hasLifecycleActions = canPause || canResume || canStop || canRestart || canResumeStopped;

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
  const lastHeardLabel = lastActivity ? formatRelativeTime(lastActivity, new Date()) : undefined;
  const sessionLabel = deriveSessionLabel(session, defaultModel);
  const sessionLabelTitle = getSessionLabelTitle(session, defaultModel, lastHeardLabel);
  const sessionStatusTitle = isPaused
    ? `Paused${session.pausedReason ? `: ${session.pausedReason}` : ''}`
    : session.awaitingInput
    ? `Awaiting user input${session.awaitingInputPrompt ? `: ${session.awaitingInputPrompt}` : '.'}`
    : getSessionStatusTitle({
        runtime,
        presence: session.presence,
        displayStatus,
        lastHeardLabel,
      });
  const sessionModel = deriveSessionModel(session, defaultModel);
  const isLiveActivity = !isPaused && (
    statusCssKey === 'running' || statusCssKey === 'working' || statusCssKey === 'thinking' || statusCssKey === 'starting'
  );
  const iconStateClass = isPaused
    ? styles.sessionIconPaused
    : statusCssKey === 'error'
      ? styles.sessionIconError
      : isLiveActivity
        ? (session.type === 'review' || session.type === 'reviewer' ? styles.sessionIconReview : styles.sessionIconRunning)
        : '';
  const durationLabel = formatDuration(session.duration);

  const restartLabel = session.type === 'review'
    ? 'Restart review'
    : session.type === 'reviewer'
      ? 'Restart review'
      : !isLive ? 'Start' : undefined;

  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>
        <button
          className={`${styles.sessionNode} ${isSelected ? styles.sessionNodeSelected : ''} ${flashClass}`}
          onClick={() => onClick?.()}
          onDoubleClick={() => {
            if (session.type === 'planning' && issueId && onOpenPlanDialog) {
              onOpenPlanDialog(issueId);
            }
          }}
        >
          <span className={styles.sessionToggleSlot}>
            {expandable && (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onToggleExpand?.(); } }}
                className={styles.sessionToggleButton}
              >
                {expanded
                  ? <ChevronDown size={12} style={{ color: 'var(--muted-foreground)' }} />
                  : <ChevronRight size={12} style={{ color: 'var(--muted-foreground)' }} />}
              </span>
            )}
          </span>
          <span className={styles.sessionDotSlot}>
            <ReviewerVerdict session={session} dotStatus={dotStatus} runtime={runtime} />
          </span>
          <span className={`${styles.sessionIconSlot} ${iconStateClass ?? ''}`} title={sessionLabelTitle}>
            <TypeIcon type={session.type} role={session.role} />
          </span>
          <span className={styles.sessionLabel} title={sessionLabelTitle}>
            {sessionLabel}
          </span>
          {sessionModel && (
            <span className={styles.sessionModel} title={sessionLabelTitle}>{sessionModel}</span>
          )}
          {subtitle && (
            <span className={styles.sessionSubtitle} title={subtitle}>{subtitle}</span>
          )}
          <LiveLastHeard lastActivity={lastActivity} />
          {!['stopped', 'unknown', 'idle', 'completed', 'running', 'working', 'thinking', 'paused'].includes(String(statusCssKey)) && (
            <span
              className={`${styles.sessionStatus} ${styles[`sessionStatus_${statusCssKey}`] ?? ''}`}
              title={sessionStatusTitle}
            >
              {displayStatus}
            </span>
          )}
          {isPaused && onUnpauseSession && (
            <span
              role="button"
              tabIndex={-1}
              data-testid="session-unpause"
              className={styles.unpauseBtn}
              title={session.pausedReason ? `Unpause — paused: ${session.pausedReason}` : 'Unpause this agent'}
              onClick={(e) => { e.stopPropagation(); onUnpauseSession(session.sessionId); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onUnpauseSession(session.sessionId); } }}
            >
              ▶ Unpause
            </span>
          )}
          {durationLabel && (
            <span className={styles.sessionDuration}>{durationLabel}</span>
          )}
        </button>
      </ContextMenuTrigger>
      {isPaused && session.pausedReason && (
        <div className={styles.sessionPausedReason} data-testid="session-paused-reason" title={session.pausedReason}>
          ⏸ {session.pausedReason}
        </div>
      )}

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
        {canResumeStopped && (
          <ContextMenuItem onSelect={() => onResumeSession!(session.sessionId)}>
            Resume session
          </ContextMenuItem>
        )}
        {isPaused && onUnpauseSession && (
          <ContextMenuItem onSelect={() => onUnpauseSession(session.sessionId)}>
            Unpause
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
            currentHarness={session.harness ?? null}
            currentModel={session.model}
            groups={groups}
            harnessPolicy={harnessPolicy}
            label={restartLabel}
            modelOrigin={session.modelOrigin}
            roleLabel={session.role ?? session.type}
            onRestart={(model, harness) => onRestartSession!(session.sessionId, issueId!, session.type, session.role, model, harness)}
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
