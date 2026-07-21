export type RecoveryJanitor = 'agent-state' | 'feedback' | 'orphan-reviewer';

export function shouldRunRecoveryJanitor(janitor: RecoveryJanitor, patrolCycle: number): boolean {
  return patrolCycle % (janitor === 'feedback' ? 5 : 60) === 0;
}
