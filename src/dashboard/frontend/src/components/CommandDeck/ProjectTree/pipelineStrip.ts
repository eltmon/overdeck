import type { SessionNode as SessionNodeType } from '@overdeck/contracts';

export type PipeSegState = 'none' | 'done' | 'working' | 'paused' | 'error' | 'merged';
export const PIPE_ORDER = ['planning', 'work', 'review', 'test', 'ship'] as const;
export const PIPE_STEP_LABELS = ['plan', 'work', 'review', 'test', 'merge'] as const;

/** The slice of ProjectFeature that derivePipeline reads — kept narrow here so
 *  this module does not import ProjectNode (which imports FeatureItem, which
 *  imports this module — a cycle). */
export interface PipelineFeature {
  stateLabel: string;
  hasPlanning: boolean;
}

/** Per-issue plan→work→review→test→ship strip. Earlier phases read done;
 *  only the live phase carries a signal color (v1.2 color restraint). */
export function derivePipeline(feature: PipelineFeature, sessions: readonly SessionNodeType[], isReady = false): PipeSegState[] {
  const isDone = feature.stateLabel.toLowerCase().includes('done');
  if (isDone) return ['done', 'done', 'done', 'done', 'merged'];

  const byPhase = PIPE_ORDER.map((phase) =>
    sessions.filter((s) => s.type === phase || (phase === 'planning' && s.type === 'legacy') || (phase === 'review' && s.type === 'reviewer')),
  );
  if (feature.hasPlanning && byPhase[0].length === 0) {
    byPhase[0] = [{ status: 'stopped' } as SessionNodeType];
  }
  let lastIdx = -1;
  for (let i = 0; i < byPhase.length; i++) {
    if (byPhase[i].length > 0) lastIdx = i;
  }
  if (isReady) lastIdx = 4;

  return PIPE_ORDER.map((_, i) => {
    if (lastIdx === -1) return 'none';
    if (i < lastIdx) return 'done';
    if (i > lastIdx) return 'none';
    if (isReady && i === 4) return 'done';
    const phaseSessions = byPhase[i];
    if (phaseSessions.length === 0) return 'done';
    if (phaseSessions.some((s) => s.status === 'error')) return 'error';
    if (phaseSessions.some((s) => s.status === 'running' || s.status === 'starting')) return 'working';
    return 'done';
  });
}

export const PIPE_CLASS: Record<PipeSegState, string> = {
  none: '',
  done: 'pipeDone',
  working: 'pipeWorking',
  paused: 'pipePaused',
  error: 'pipeError',
  merged: 'pipeMerged',
};

/** Human label for a segment state. */
export function describePipeSegment(seg: PipeSegState): string {
  switch (seg) {
    case 'none': return 'pending';
    case 'done': return 'done';
    case 'working': return 'running';
    case 'paused': return 'paused';
    case 'error': return 'failed';
    case 'merged': return 'merged';
  }
}

/** Strip label: names the current step (the last non-'none' segment). */
export function describePipeline(segments: readonly PipeSegState[]): string {
  const summary = PIPE_STEP_LABELS.map((label, i) => `${label} ${describePipeSegment(segments[i])}`).join(' · ');

  let lastIdx = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] !== 'none') lastIdx = i;
  }
  if (lastIdx === -1) {
    return `Not started — ${summary}`;
  }
  return `Step ${lastIdx + 1} of ${segments.length}: ${PIPE_STEP_LABELS[lastIdx]} (${describePipeSegment(segments[lastIdx])}) — ${summary}`;
}
