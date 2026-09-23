import { deleteReleaseSet as dbDelete, getAllReleaseSetsFromDb, getReleaseSetFromDb, upsertReleaseSet as dbUpsert } from './overdeck/release-sync.js';
import { resolveIssueIdSync } from './issue-id.js';
import type {
  ReleaseCheckStatus,
  ReleaseComponentState,
  ReleaseComponentStatus,
  ReleaseSet,
  ReleaseSetStatus,
  RollbackStatus,
} from './release-set-types.js';

export type {
  ReleaseCheckStatus,
  ReleaseComponentState,
  ReleaseComponentStatus,
  ReleaseSet,
  ReleaseSetStatus,
  RollbackStatus,
} from './release-set-types.js';

export function upsertReleaseSetSync(releaseSet: ReleaseSet): void {
  dbUpsert({ ...releaseSet, issueId: resolveIssueIdSync(releaseSet.issueId) });
}

export function getReleaseSetSync(issueId: string): ReleaseSet | null {
  return getReleaseSetFromDb(resolveIssueIdSync(issueId));
}

export function getAllReleaseSetsSync(projectKey?: string): ReleaseSet[] {
  return getAllReleaseSetsFromDb(projectKey);
}

export function deleteReleaseSetSync(issueId: string): void {
  dbDelete(resolveIssueIdSync(issueId));
}

export function withComponentStateSync(
  releaseSet: ReleaseSet,
  componentKey: string,
  patch: Partial<ReleaseComponentState>,
): ReleaseSet {
  const now = new Date().toISOString();
  return {
    ...releaseSet,
    updatedAt: now,
    components: releaseSet.components.map(component => (
      component.componentKey === componentKey
        ? { ...component, ...patch, componentKey }
        : component
    )),
  };
}
