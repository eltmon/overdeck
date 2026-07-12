/**
 * release-sync.ts — Sync accessors for the release-set domain.
 *
 * Routes release set reads/writes through the overdeck database door instead
 * of the legacy panopticon.db surface (PAN-399).
 */

import { getOverdeckDatabaseSync } from './infra.js';
import type { ReleaseComponentState, ReleaseSet } from '../release-set-types.js';

// overdeck stores INTEGER milliseconds; ReleaseSet uses ISO strings.
function isoFromMillis(value: number): string {
  return new Date(value).toISOString();
}

function millisFromIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function nowMillis(): number {
  return Date.now();
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

function rowToReleaseSet(row: OverdeckReleaseSetRow, components: ReleaseComponentState[]): ReleaseSet {
  return {
    issueId: row.issue_id,
    projectKey: row.project_key,
    projectPath: row.project_path,
    workspaceType: row.workspace_type as ReleaseSet['workspaceType'],
    status: row.status as ReleaseSet['status'],
    createdAt: isoFromMillis(row.created_at),
    updatedAt: isoFromMillis(row.updated_at),
    components,
  };
}

function rowToReleaseComponent(row: OverdeckReleaseComponentRow): ReleaseComponentState {
  return {
    componentKey: row.component_key,
    provider: row.provider ?? undefined,
    trigger: row.trigger as ReleaseComponentState['trigger'],
    releaseOrder: row.release_order,
    required: row.required === 1,
    status: row.status as ReleaseComponentState['status'],
    healthStatus: (row.health_status as ReleaseComponentState['healthStatus']) ?? undefined,
    versionStatus: (row.version_status as ReleaseComponentState['versionStatus']) ?? undefined,
    smokeStatus: (row.smoke_status as ReleaseComponentState['smokeStatus']) ?? undefined,
    rollbackStatus: (row.rollback_status as ReleaseComponentState['rollbackStatus']) ?? undefined,
    notes: row.notes ?? undefined,
  };
}

function loadComponentsForReleaseSet(
  db: ReturnType<typeof getOverdeckDatabaseSync>,
  issueId: string,
): ReleaseComponentState[] {
  const rows = db.prepare(`
    SELECT component_key, provider, trigger, release_order, required, status,
           health_status, version_status, smoke_status, rollback_status, notes
    FROM release_set_components
    WHERE issue_id = ?
    ORDER BY release_order ASC, component_key ASC
  `).all(issueId) as OverdeckReleaseComponentRow[];
  return rows.map(rowToReleaseComponent);
}

/** Insert or replace a release set and its component rows. */
export function upsertReleaseSet(releaseSet: ReleaseSet): void {
  const db = getOverdeckDatabaseSync();
  const createdAtMs = millisFromIso(releaseSet.createdAt) ?? nowMillis();
  const updatedAtMs = millisFromIso(releaseSet.updatedAt) ?? nowMillis();

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
      createdAtMs,
      updatedAtMs,
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

/** Fetch a release set by issue id, or null if none exists. */
export function getReleaseSetFromDb(issueId: string): ReleaseSet | null {
  const db = getOverdeckDatabaseSync();
  const row = db.prepare(`
    SELECT issue_id, project_key, project_path, workspace_type, status, created_at, updated_at
    FROM release_sets
    WHERE issue_id = ?
  `).get(issueId) as OverdeckReleaseSetRow | undefined;
  if (!row) return null;
  return rowToReleaseSet(row, loadComponentsForReleaseSet(db, issueId));
}

/** List release sets, optionally filtered by project key. */
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

  return rows.map(row => rowToReleaseSet(row, loadComponentsForReleaseSet(db, row.issue_id)));
}

/** Delete a release set and its component rows. */
export function deleteReleaseSet(issueId: string): void {
  const db = getOverdeckDatabaseSync();
  // Components are deleted via ON DELETE CASCADE; delete the parent explicitly.
  db.prepare('DELETE FROM release_sets WHERE issue_id = ?').run(issueId);
}
