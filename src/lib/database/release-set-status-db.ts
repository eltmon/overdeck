import { getDatabase } from './index.js';

export interface ReleaseSetComponentStatus {
  componentKey: string;
  provider: string;
  trigger: string;
  releaseOrder: number;
  required: boolean;
  status: string;
  healthStatus: string;
  versionStatus: string;
  smokeStatus: string;
  rollbackStatus: string;
  notes?: string;
}

interface ReleaseSetComponentRow {
  component_key: string;
  provider: string;
  trigger: string;
  release_order: number;
  required: number;
  status: string;
  health_status: string;
  version_status: string;
  smoke_status: string;
  rollback_status: string;
  notes: string | null;
}

export function getReleaseSetComponentsForIssueSync(issueId: string): ReleaseSetComponentStatus[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT
      component_key,
      provider,
      trigger,
      release_order,
      required,
      status,
      health_status,
      version_status,
      smoke_status,
      rollback_status,
      notes
    FROM release_set_components
    WHERE issue_id = ?
    ORDER BY release_order ASC, component_key ASC
  `).all(issueId) as ReleaseSetComponentRow[];

  return rows.map((row) => ({
    componentKey: row.component_key,
    provider: row.provider,
    trigger: row.trigger,
    releaseOrder: row.release_order,
    required: row.required === 1,
    status: row.status,
    healthStatus: row.health_status,
    versionStatus: row.version_status,
    smokeStatus: row.smoke_status,
    rollbackStatus: row.rollback_status,
    notes: row.notes ?? undefined,
  }));
}
