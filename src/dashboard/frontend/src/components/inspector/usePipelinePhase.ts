import { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import type { Agent } from '../../types';
import { compareWorkAgents, getWorkSessionLabel, isAgentSessionActive, isAgentSessionAttachable } from '../../lib/swarmSlots';
import type { ReviewStatus } from './types';
import type { PipelinePhase, TerminalTab } from './TerminalTabs';

export interface PipelinePhaseInput {
  issueId: string;
  agent?: Agent;
  workAgents?: Agent[];
  reviewStatus?: ReviewStatus;
  /** The canonical project key used in specialist session names (e.g. "panopticon") */
  projectKey?: string;
}

export interface PipelinePhaseResult {
  phase: PipelinePhase;
  activeSession: string | null;
  availableTerminals: TerminalTab[];
}

/**
 * Derive the current pipeline phase from inputs.
 * Pure function — unit-testable without React.
 *
 * Precedence (first match wins):
 *   merging (queued|merging|verifying mergeStatus) → merged → testing → reviewing
 *   → review-feedback → working → planning
 */
export function derivePipelinePhase(
  input: PipelinePhaseInput,
  deadSessions: ReadonlySet<string> = new Set(),
): PipelinePhaseResult {
  const { agent, reviewStatus, projectKey, issueId } = input;

  const workAgents = (input.workAgents?.length ? input.workAgents : (agent ? [agent] : []))
    .slice()
    .sort(compareWorkAgents);
  const primaryAgent = agent ?? workAgents[0];
  const primaryWorkSession = primaryAgent?.id ?? null;
  const liveWorkAgents = workAgents.filter(isAgentSessionAttachable);
  const liveWorkSession = liveWorkAgents[0]?.id ?? primaryWorkSession;

  // Session name helpers
  const specialistSession = (role: string): string =>
    projectKey ? `specialist-${projectKey}-${issueId}-${role}` : `specialist-${role}`;

  // Parallel review sessions use review-<issueId>-<timestamp>-<role> naming.
  // Prefer actual discovered session names from the backend when available.
  // The coordinator is the top-level Review tab; per-role reviewer sessions
  // render as child review tabs.
  const reviewCoordinatorSession = reviewStatus?.reviewCoordinatorSessionName ?? null;
  const reviewSessionNames = reviewStatus?.reviewSessionNames;
  const liveReviewerSession = reviewSessionNames?.find(s => !deadSessions.has(s)) ?? null;

  const testSession = specialistSession('test-agent');
  const mergeSession = specialistSession('merge-agent');

  const ms = reviewStatus?.mergeStatus;
  const rs = reviewStatus?.reviewStatus;
  const ts = reviewStatus?.testStatus;

  // Phase detection — precedence order
  let phase: PipelinePhase;
  let activeSession: string | null;

  if (ms === 'queued' || ms === 'merging' || ms === 'verifying') {
    phase = 'merging';
    // Monorepo merges use the work agent for rebase (no merge-agent is spawned).
    // Polyrepo merges spawn a merge-agent (work agent is stopped by then).
    // If any work session is alive, it's handling the merge — stream it.
    if (liveWorkSession && liveWorkAgents.some(isAgentSessionActive)) {
      activeSession = liveWorkSession;
    } else {
      activeSession = deadSessions.has(mergeSession) ? null : mergeSession;
    }
  } else if (ms === 'merged') {
    phase = 'merged';
    activeSession = null;
  } else if (ts === 'testing') {
    phase = 'testing';
    activeSession = deadSessions.has(testSession) ? null : testSession;
  } else if (rs === 'reviewing') {
    phase = 'reviewing';
    if (reviewCoordinatorSession && !deadSessions.has(reviewCoordinatorSession)) {
      activeSession = reviewCoordinatorSession;
    } else if (reviewSessionNames && reviewSessionNames.length > 0) {
      activeSession = liveReviewerSession;
    } else {
      activeSession = null;
    }
  } else if ((rs === 'failed' || rs === 'blocked') && liveWorkSession && liveWorkAgents.some(isAgentSessionActive)) {
    phase = 'review-feedback';
    activeSession = liveWorkSession;
  } else if (primaryAgent?.agentPhase === 'planning' && isAgentSessionActive(primaryAgent)) {
    phase = 'planning';
    activeSession = primaryWorkSession;
  } else if (liveWorkSession && liveWorkAgents.some(isAgentSessionActive)) {
    phase = 'working';
    activeSession = liveWorkSession;
  } else if (primaryAgent?.status === 'stopped' && primaryAgent?.agentPhase === 'review-response') {
    // Agent called pan done and is on standby for UAT tweaks / review feedback.
    phase = 'standby';
    activeSession = primaryWorkSession;
  } else {
    phase = 'planning';
    activeSession = null; // planning session only shown if it exists
  }

  // Build available tabs — only include tabs that are relevant to the current state
  const tabs: TerminalTab[] = [];

  const isPlanningAgent = primaryAgent?.agentPhase === 'planning';

  if (isPlanningAgent && primaryWorkSession) {
    tabs.push({
      id: 'planning',
      label: 'Planning',
      sessionName: primaryWorkSession,
      isActive: phase === 'planning',
      disabled: deadSessions.has(primaryWorkSession),
      isRunning: phase === 'planning',
    });
  } else if (workAgents.length === 1 && primaryWorkSession) {
    tabs.push({
      id: 'working',
      label: 'Work',
      sessionName: primaryWorkSession,
      isActive: phase === 'working' || phase === 'review-feedback' || phase === 'standby',
      disabled: deadSessions.has(primaryWorkSession),
      isRunning: phase === 'working',
    });
  } else {
    for (const [index, workAgent] of workAgents.entries()) {
      tabs.push({
        id: index === 0 ? 'working' : `working-${workAgent.id}`,
        label: getWorkSessionLabel(workAgent, index),
        sessionName: workAgent.id,
        isActive:
          (phase === 'working' || phase === 'review-feedback' || phase === 'standby') &&
          activeSession === workAgent.id,
        disabled: deadSessions.has(workAgent.id),
        isRunning: isAgentSessionActive(workAgent),
      });
    }
  }

  // Review tab: show once review has started (not just pending)
  const reviewSubStatuses = reviewStatus?.reviewSubStatuses;
  const isReviewDone = rs === 'passed' || rs === 'failed' || rs === 'blocked';
  if (rs && rs !== 'pending') {
    const hasLiveCoordinator = !!reviewCoordinatorSession && !deadSessions.has(reviewCoordinatorSession);
    tabs.push({
      id: 'reviewing',
      label: 'Review',
      sessionName: reviewCoordinatorSession,
      isActive: phase === 'reviewing' && hasLiveCoordinator && activeSession === reviewCoordinatorSession,
      disabled: !hasLiveCoordinator || isReviewDone,
      isRunning: phase === 'reviewing' && hasLiveCoordinator && !isReviewDone,
    });

    if (reviewSessionNames && reviewSessionNames.length > 0) {
      for (const sessionName of reviewSessionNames) {
        const role = sessionName.split('-').pop() || 'review';
        const isDone = reviewSubStatuses?.[role] === 'done';
        tabs.push({
          id: `reviewing-${role}`,
          label: `Review (${role})`,
          sessionName,
          isActive: phase === 'reviewing' && activeSession === sessionName,
          disabled: deadSessions.has(sessionName) || isDone || isReviewDone,
          isRunning: phase === 'reviewing' && !isDone && !isReviewDone,
        });
      }
    }
  }

  // Test tab: show once testing has started
  if (ts && ts !== 'pending') {
    tabs.push({
      id: 'testing',
      label: 'Test',
      sessionName: testSession,
      isActive: phase === 'testing',
      disabled: deadSessions.has(testSession),
      isRunning: phase === 'testing',
    });
  }

  // Merge tab: show once merge has been queued or beyond
  if (ms && ms !== 'pending') {
    // Monorepo merges stream the active work session (it handles rebase); polyrepo uses merge-agent.
    const effectiveMergeSession = (liveWorkSession && liveWorkAgents.some(isAgentSessionActive))
      ? liveWorkSession
      : mergeSession;
    tabs.push({
      id: 'merging',
      label: 'Merge',
      sessionName: effectiveMergeSession,
      isActive: phase === 'merging',
      disabled: ms === 'merged' || deadSessions.has(effectiveMergeSession),
      isRunning: phase === 'merging',
    });
  }

  return { phase, activeSession, availableTerminals: tabs };
}

/**
 * React hook wrapping derivePipelinePhase. Tracks dead sessions via onSessionEnded callbacks.
 * Auto-switches are debounced by 1 second to prevent churn.
 */
export function usePipelinePhase(input: PipelinePhaseInput): PipelinePhaseResult & {
  markSessionDead: (sessionName: string) => void;
} {
  const [deadSessions, setDeadSessions] = useState<Set<string>>(() => new Set());

  const markSessionDead = useCallback((sessionName: string) => {
    setDeadSessions(prev => {
      if (prev.has(sessionName)) return prev;
      const next = new Set(prev);
      next.add(sessionName);
      return next;
    });
  }, []);

  // Cache review sessions: the backend discovers them from live tmux sessions,
  // but by the time the review result (passed/failed) is emitted the sessions
  // may already be killed. Without caching, tabs disappear immediately.
  const cachedCoordinatorSessionRef = useRef<string | undefined>(undefined);
  const cachedSessionNamesRef = useRef<string[] | undefined>(undefined);
  const liveCoordinator = input.reviewStatus?.reviewCoordinatorSessionName;
  const liveNames = input.reviewStatus?.reviewSessionNames;
  if (liveCoordinator) {
    cachedCoordinatorSessionRef.current = liveCoordinator;
  }
  if (liveNames && liveNames.length > 0) {
    cachedSessionNamesRef.current = liveNames;
  }
  const effectiveInput = useMemo(() => {
    if (!input.reviewStatus) return input;
    const reviewStatus = { ...input.reviewStatus };
    let changed = false;
    if (!liveCoordinator && cachedCoordinatorSessionRef.current) {
      reviewStatus.reviewCoordinatorSessionName = cachedCoordinatorSessionRef.current;
      changed = true;
    }
    if ((!liveNames || liveNames.length === 0) && cachedSessionNamesRef.current) {
      reviewStatus.reviewSessionNames = cachedSessionNamesRef.current;
      changed = true;
    }
    if (!changed) return input;
    return {
      ...input,
      reviewStatus,
    };
  }, [input, liveCoordinator, liveNames]);

  // Debounce phase changes by 1s to prevent auto-switch churn
  const resultRef = useRef<PipelinePhaseResult | null>(null);
  const [debouncedResult, setDebouncedResult] = useState<PipelinePhaseResult>(() =>
    derivePipelinePhase(effectiveInput, deadSessions),
  );
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workAgentKey = (effectiveInput.workAgents ?? [])
    .map((workAgent) => `${workAgent.id}:${workAgent.status}:${workAgent.agentPhase ?? ''}`)
    .join('|');

  const immediateResult = useMemo(
    () => derivePipelinePhase(effectiveInput, deadSessions),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- agent/work-agent deps narrowed to id+status;
    // the full object references change on every parent render, which would reset the 1s debounce timer
    [effectiveInput.agent?.id, effectiveInput.agent?.status, workAgentKey, effectiveInput.reviewStatus, effectiveInput.projectKey, effectiveInput.issueId, deadSessions],
  );

  useEffect(() => {
    const prev = resultRef.current;
    resultRef.current = immediateResult;

    // If phase changed, debounce the update to avoid rapid tab switching
    if (prev?.phase !== immediateResult.phase) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        setDebouncedResult(immediateResult);
      }, 1000);
    } else {
      // Non-phase changes (session added/removed) apply immediately
      setDebouncedResult(immediateResult);
    }
  }, [immediateResult]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  return {
    ...debouncedResult,
    markSessionDead,
  };
}
