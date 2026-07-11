import {
  deleteReleaseSet as dbDelete,
  getAllReleaseSetsFromDb,
  getReleaseSetFromDb,
  upsertReleaseSet as dbUpsert,
} from './database/release-set-db.js';

export type ReleaseSetStatus = 'pending' | 'releasing' | 'passed' | 'failed' | 'partial' | 'rolled_back' | 'skipped';
export type ReleaseComponentStatus = 'pending' | 'releasing' | 'passed' | 'failed' | 'skipped' | 'blocked' | 'rolled_back';
export type ReleaseComponentCheckStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'blocked' | 'rolled_back';

export interface ReleaseComponentState {
  componentKey: string;
  provider?: string;
  trigger: string;
  releaseOrder: number;
  required: boolean;
  status: ReleaseComponentStatus;
  healthStatus: ReleaseComponentCheckStatus;
  versionStatus: ReleaseComponentCheckStatus;
  smokeStatus: ReleaseComponentCheckStatus;
  rollbackStatus: ReleaseComponentCheckStatus;
  notes?: string;
}

export interface ReleaseSet {
  issueId: string;
  projectKey: string;
  projectPath: string;
  workspaceType: 'monorepo' | 'polyrepo';
  status: ReleaseSetStatus;
  createdAt: string;
  updatedAt: string;
  components: ReleaseComponentState[];
}

export function upsertReleaseSetSync(releaseSet: ReleaseSet): void {
  dbUpsert(releaseSet);
}

export function getReleaseSetSync(issueId: string): ReleaseSet | null {
  return getReleaseSetFromDb(issueId);
}

export function getAllReleaseSetsSync(projectKey?: string): ReleaseSet[] {
  return getAllReleaseSetsFromDb(projectKey);
}

export function deleteReleaseSetSync(issueId: string): void {
  dbDelete(issueId);
}

export function withComponentStateSync(
  releaseSet: ReleaseSet,
  componentKey: string,
  patch: Partial<ReleaseComponentState>
): ReleaseSet {
  return {
    ...releaseSet,
    updatedAt: new Date().toISOString(),
    components: releaseSet.components.map(component => (
      component.componentKey === componentKey
        ? { ...component, ...patch }
        : component
    )),
  };
}
