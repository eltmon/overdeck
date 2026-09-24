import { getReleaseSetFromDb, upsertReleaseSetRow } from './overdeck/release-sync.js';
import { resolveIssueId } from './issue-id.js';
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

export function upsertReleaseSet(releaseSet: ReleaseSet): void {
  upsertReleaseSetRow({ ...releaseSet, issueId: resolveIssueId(releaseSet.issueId) });
}

export function getReleaseSet(issueId: string): ReleaseSet | null {
  return getReleaseSetFromDb(resolveIssueId(issueId));
}

export function withComponentState(
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
