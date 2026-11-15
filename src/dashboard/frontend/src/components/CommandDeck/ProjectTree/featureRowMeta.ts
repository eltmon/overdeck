/**
 * featureRowMeta — the words on a collapsed issue row's second line
 * (PAN-5293 F-D16): stage word (or "Needs you") · agent model · progress.
 */

import type { SessionNode } from '@overdeck/contracts';
import type { PipelineIssuePhase } from '../../../lib/pipeline-state';
import { shortModel } from '../modelLabels';

export const STAGE_WORDS: Record<PipelineIssuePhase, string> = {
  todo: 'Not started',
  plan: 'Planning',
  work: 'Building',
  ready: 'Ready',
  review: 'In review',
  ship: 'Ready to merge',
};

export interface FeatureRowMetaInput {
  phase: PipelineIssuePhase;
  needsYou: boolean;
  sessions?: readonly Pick<SessionNode, 'presence' | 'model' | 'startedAt'>[];
  taskTotals?: { total: number; closed: number } | null;
}

export function featureRowMetaParts({ phase, needsYou, sessions, taskTotals }: FeatureRowMetaInput): string[] {
  const parts = [needsYou ? 'Needs you' : STAGE_WORDS[phase]];
  const newestActive = (sessions ?? [])
    .filter((session) => session.presence === 'active' && session.model)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (newestActive) parts.push(shortModel(newestActive.model));
  if (taskTotals && taskTotals.total > 0) parts.push(`${taskTotals.closed} of ${taskTotals.total} items`);
  return parts;
}
