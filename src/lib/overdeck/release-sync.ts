import { getOverdeckDatabaseSync } from './infra.js';
import type { ReleaseComponentState, ReleaseSet } from '../release-set.js';

function isoFromMillisRequired(value: number): string {
  return new Date(value).toISOString();
}

function millisFromIso(value: string | null | undefined): number {
  if (!value) return Date.now();
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Date.now();
}

interface OverdeckReleaseSetRow {
  issue_id: string;
  project_key: string;
  project_path: string;
  workspace_type: string;
  status: string;
  created_at: number;
  updated_at: number;
}

interface OverdeckReleaseComponentRow {
  component_key: string;
  provider: string | null;
  trigger: string;
  release_order: number;
  required: number;
  status: string;
  health_status: string | null;
  version_status: string | null;
  smoke_status: string | null;
  rollback_status: string | null;
  notes: string | null;
}

export function upsertReleaseSet(releaseSet: ReleaseSet): void {
  const db = getOverdeckDatabaseSync();
  const tx = db.transaction((set: ReleaseSet) => {
    db.prepare(`
      INSERT INTO release_sets (
        issue_id, project_key, project_path, workspace_type, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        project_key = excluded.project_key,
        project_path = excluded.project_path,
        workspace_type = excluded.workspace_type,
        status = excluded.status,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      set.issueId,
      set.projectKey,
      set.projectPath,
      set.workspaceType,
      set.status,
      millisFromIso(set.createdAt),
      millisFromIso(set.updatedAt),
    );

    db.prepare('DELETE FROM release_set_components WHERE issue_id = ?').run(set.issueId);

    const insertComponent = db.prepare(`
      INSERT INTO release_set_components (
        issue_id, component_key, provider, trigger, release_order, required, status,
        health_status, version_status, smoke_status, rollback_status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const component of set.components) {
      insertComponent.run(
        set.issueId,
        component.componentKey,
        component.provider ?? null,
        component.trigger,
        component.releaseOrder,
        component.required ? 1 : 0,
        component.status,
        component.healthStatus ?? null,
        component.versionStatus ?? null,
        component.smokeStatus ?? null,
        component.rollbackStatus ?? null,
        component.notes ?? null,
      );
    }
  });

  tx(releaseSet);
}

export function getReleaseSetFromDb(issueId: string): ReleaseSet | null {
  const db = getOverdeckDatabaseSync();
  const row = db.prepare(`
    SELECT issue_id, project_key, project_path, workspace_type, status, created_at, updated_at
    FROM release_sets
    WHERE issue_id = ?
  `).get(issueId) as OverdeckReleaseSetRow | undefined;
  if (!row) return null;
  return rowToReleaseSet(row, loadComponentsForReleaseSet(issueId));
}

export function getAllReleaseSetsFromDb(projectKey?: string): ReleaseSet[] {
  const db = getOverdeckDatabaseSync();
  const rows = (
    projectKey
      ? db.prepare(`
          SELECT issue_id, project_key, project_path, workspace_type, status, created_at, updated_at
          FROM release_sets
          WHERE project_key = ?
          ORDER BY updated_at DESC
        `).all(projectKey)
      : db.prepare(`
          SELECT issue_id, project_key, project_path, workspace_type, status, created_at, updated_at
          FROM release_sets
          ORDER BY updated_at DESC
        `).all()
  ) as OverdeckReleaseSetRow[];

  return rows.map((row) => rowToReleaseSet(row, loadComponentsForReleaseSet(row.issue_id)));
}

export function deleteReleaseSet(issueId: string): void {
  const db = getOverdeckDatabaseSync();
  db.prepare('DELETE FROM release_set_components WHERE issue_id = ?').run(issueId);
  db.prepare('DELETE FROM release_sets WHERE issue_id = ?').run(issueId);
}

function loadComponentsForReleaseSet(issueId: string): ReleaseComponentState[] {
  const db = getOverdeckDatabaseSync();
  const rows = db.prepare(`
    SELECT component_key, provider, trigger, release_order, required, status,
           health_status, version_status, smoke_status, rollback_status, notes
    FROM release_set_components
    WHERE issue_id = ?
    ORDER BY release_order ASC, component_key ASC
  `).all(issueId) as OverdeckReleaseComponentRow[];

  return rows.map((row) => ({
    componentKey: row.component_key,
    provider: row.provider ?? undefined,
    trigger: row.trigger as ReleaseComponentState['trigger'],
    releaseOrder: row.release_order,
    required: row.required === 1,
    status: row.status as ReleaseComponentState['status'],
    healthStatus: row.health_status as ReleaseComponentState['healthStatus'] ?? undefined,
    versionStatus: row.version_status as ReleaseComponentState['versionStatus'] ?? undefined,
    smokeStatus: row.smoke_status as ReleaseComponentState['smokeStatus'] ?? undefined,
    rollbackStatus: row.rollback_status as ReleaseComponentState['rollbackStatus'] ?? undefined,
    notes: row.notes ?? undefined,
  }));
}

function rowToReleaseSet(row: OverdeckReleaseSetRow, components: ReleaseComponentState[]): ReleaseSet {
  return {
    issueId: row.issue_id,
    projectKey: row.project_key,
    projectPath: row.project_path,
    workspaceType: row.workspace_type as ReleaseSet['workspaceType'],
    status: row.status as ReleaseSet['status'],
    createdAt: isoFromMillisRequired(row.created_at),
    updatedAt: isoFromMillisRequired(row.updated_at),
    components,
  };
}
