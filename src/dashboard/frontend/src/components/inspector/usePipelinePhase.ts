import { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import type { Agent } from '../../types';
import type { ReviewStatus } from './types';
import type { PipelinePhase, TerminalTab } from './TerminalTabs';

export interface PipelinePhaseInput {
  issueId: string;
  agent?: Agent;
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

  // Session name helpers
  const workSession = agent?.id ?? null;
  const specialistSession = (role: string): string =>
    projectKey ? `specialist-${projectKey}-${issueId}-${role}` : `specialist-${role}`;

  // Parallel review sessions use review-<issueId>-<timestamp>-<role> naming.
  // Prefer actual discovered session names from the backend when available.
  // No fallback to old specialist- naming — if sessions aren't discovered yet,
  // the tab renders without a terminal connection until the backend finds them.
  const reviewSessionNames = reviewStatus?.reviewSessionNames;
  const reviewSession = reviewSessionNames && reviewSessionNames.length > 0
    ? reviewSessionNames[0]
    : null;

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
    // If the work agent is alive, it's handling the merge — stream it.
    if (workSession && (agent?.status === 'healthy' || agent?.status === 'starting')) {
      activeSession = workSession;
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
    if (reviewSessionNames && reviewSessionNames.length > 0) {
      activeSession = reviewSessionNames.find(s => !deadSessions.has(s)) || reviewSessionNames[0] || null;
    } else {
      activeSession = reviewSession && !deadSessions.has(reviewSession) ? reviewSession : null;
    }
  } else if ((rs === 'failed' || rs === 'blocked') && (agent?.status === 'healthy' || agent?.status === 'starting')) {
    phase = 'review-feedback';
    activeSession = workSession;
  } else if (agent?.agentPhase === 'planning' && (agent?.status === 'healthy' || agent?.status === 'starting')) {
    phase = 'planning';
    activeSession = workSession;
  } else if (agent?.status === 'healthy' || agent?.status === 'starting') {
    phase = 'working';
    activeSession = workSession;
  } else if (agent?.status === 'stopped' && agent?.agentPhase === 'review-response') {
    // Agent called pan done and is on standby for UAT tweaks / review feedback.
    phase = 'standby';
    activeSession = workSession;
  } else {
    phase = 'planning';
    activeSession = null; // planning session only shown if it exists
  }

  // Build available tabs — only include tabs that are relevant to the current state
  const tabs: TerminalTab[] = [];

  const isPlanningAgent = agent?.agentPhase === 'planning';

  // Work/Planning tab: always show if agent exists
  if (workSession) {
    tabs.push({
      id: isPlanningAgent ? 'planning' : 'working',
      label: isPlanningAgent ? 'Planning' : 'Work',
      sessionName: workSession,
      isActive: isPlanningAgent ? phase === 'planning' : phase === 'working' || phase === 'review-feedback' || phase === 'standby',
      disabled: deadSessions.has(workSession),
      isRunning: isPlanningAgent ? phase === 'planning' : phase === 'working',
    });
  }

  // Review tab: show once review has started (not just pending)
  const reviewSubStatuses = reviewStatus?.reviewSubStatuses;
  const isReviewDone = rs === 'passed' || rs === 'failed' || rs === 'blocked';
  if (rs && rs !== 'pending') {
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
    } else if (reviewSession) {
      tabs.push({
        id: 'reviewing',
        label: 'Review',
        sessionName: reviewSession,
        isActive: phase === 'reviewing',
        disabled: deadSessions.has(reviewSession) || isReviewDone,
        isRunning: phase === 'reviewing' && !isReviewDone,
      });
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
    // Monorepo merges stream the work agent (it handles rebase); polyrepo uses merge-agent.
    const effectiveMergeSession = (workSession && (agent?.status === 'healthy' || agent?.status === 'starting'))
      ? workSession
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

  // Debounce phase changes by 1s to prevent auto-switch churn
  const resultRef = useRef<PipelinePhaseResult | null>(null);
  const [debouncedResult, setDebouncedResult] = useState<PipelinePhaseResult>(() =>
    derivePipelinePhase(input, deadSessions),
  );
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const immediateResult = useMemo(
    () => derivePipelinePhase(input, deadSessions),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- input.agent narrowed to id+status;
    // the full object reference changes on every parent render, which would reset the 1s debounce timer
    [input.agent?.id, input.agent?.status, input.reviewStatus, input.projectKey, input.issueId, deadSessions],
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
