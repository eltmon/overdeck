import { getOverdeckDatabaseSync } from './infra.js';
import type { Stage } from './issues.js';

export function getIssueStageSync(issueId: string): string | null {
  const row = getOverdeckDatabaseSync()
    .prepare(`SELECT stage FROM issues WHERE id = ?`)
    .get(issueId) as { stage: string } | undefined;
  return row?.stage ?? null;
}

const TERMINAL_ISSUE_STAGES = new Set<Stage>(['verifying_on_main', 'closed', 'cancelled']);

export function isTerminalIssueStage(stage: string | null): boolean {
  return TERMINAL_ISSUE_STAGES.has(stage as Stage);
}
