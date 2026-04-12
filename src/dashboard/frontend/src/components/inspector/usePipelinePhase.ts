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
 *   merging → testing → reviewing → verifying → working → planning → merged
 */
export function derivePipelinePhase(
  input: PipelinePhaseInput,
  deadSessions: ReadonlySet<string> = new Set(),
): PipelinePhaseResult {
  const { agent, reviewStatus, projectKey } = input;

  // Session name helpers
  const workSession = agent?.id ?? null;
  const specialistSession = (role: string): string =>
    projectKey ? `specialist-${projectKey}-${role}` : `specialist-${role}`;

  const reviewSession = specialistSession('review-agent');
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
    activeSession = deadSessions.has(mergeSession) ? null : mergeSession;
  } else if (ms === 'merged') {
    phase = 'merged';
    activeSession = null;
  } else if (ts === 'testing') {
    phase = 'testing';
    activeSession = deadSessions.has(testSession) ? null : testSession;
  } else if (rs === 'reviewing') {
    phase = 'reviewing';
    activeSession = deadSessions.has(reviewSession) ? null : reviewSession;
  } else if (rs === 'failed' && (agent?.status === 'healthy' || agent?.status === 'starting')) {
    phase = 'review-feedback';
    activeSession = workSession;
  } else if (agent?.status === 'healthy' || agent?.status === 'starting') {
    phase = 'working';
    activeSession = workSession;
  } else {
    phase = 'planning';
    activeSession = null; // planning session only shown if it exists
  }

  // Build available tabs — only include tabs that are relevant to the current state
  const tabs: TerminalTab[] = [];

  // Planning tab: shown if a planning session exists (can't check from pure fn, handled by hook)
  // We include it in the list but callers add it conditionally

  // Work tab: always show if agent exists
  if (workSession) {
    tabs.push({
      id: 'working',
      label: 'Work',
      sessionName: workSession,
      isActive: phase === 'working' || phase === 'review-feedback',
      disabled: deadSessions.has(workSession),
    });
  }

  // Review tab: show once review has started (not just pending)
  if (rs && rs !== 'pending') {
    tabs.push({
      id: 'reviewing',
      label: 'Review',
      sessionName: reviewSession,
      isActive: phase === 'reviewing',
      disabled: deadSessions.has(reviewSession),
    });
  }

  // Test tab: show once testing has started
  if (ts && ts !== 'pending') {
    tabs.push({
      id: 'testing',
      label: 'Test',
      sessionName: testSession,
      isActive: phase === 'testing',
      disabled: deadSessions.has(testSession),
    });
  }

  // Merge tab: show once merge has been queued or beyond
  if (ms && ms !== 'pending') {
    tabs.push({
      id: 'merging',
      label: 'Merge',
      sessionName: mergeSession,
      isActive: phase === 'merging',
      disabled: ms === 'merged' || deadSessions.has(mergeSession),
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
  deadSessions: Set<string>;
  planningSessionName: string;
} {
  const { issueId } = input;
  const [deadSessions, setDeadSessions] = useState<Set<string>>(() => new Set());
  const planningSessionName = `planning-${issueId}`;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.agent, input.reviewStatus, input.projectKey, input.issueId, deadSessions],
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
    deadSessions,
    planningSessionName,
  };
}
