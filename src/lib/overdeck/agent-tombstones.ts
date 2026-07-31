import { getOverdeckDatabaseSync } from './infra.js';

export const RETAINED_TRANSCRIPTS_PHASE = 'retained-transcripts';

export interface AgentTombstoneIdentity {
  id: string;
  issueId: string;
  role: string;
  workspace: string;
  harness: string;
  model: string;
}

export function tombstoneAgentRecordSync(agentId: string): void {
  try {
    getOverdeckDatabaseSync().prepare(`
      UPDATE agents
      SET status = 'stopped', session_id = NULL, phase = ?, updated_at = ?
      WHERE id = ?
    `).run(RETAINED_TRANSCRIPTS_PHASE, Date.now(), agentId);
  } catch { /* agents table missing */ }
}

export function ensureAgentTombstoneSync(identity: AgentTombstoneIdentity): void {
  getOverdeckDatabaseSync().prepare(`
    INSERT INTO agents (id, issue_id, role, status, workspace, harness, model, phase, updated_at)
    VALUES (?, ?, ?, 'stopped', ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = 'stopped', session_id = NULL, phase = excluded.phase, updated_at = excluded.updated_at
  `).run(
    identity.id,
    identity.issueId,
    identity.role,
    identity.workspace,
    identity.harness,
    identity.model,
    RETAINED_TRANSCRIPTS_PHASE,
    Date.now(),
  );
}
