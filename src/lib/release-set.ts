import { Effect } from 'effect';
import {
  deleteReleaseSet as dbDelete,
  getAllReleaseSetsFromDb,
  getReleaseSetFromDb,
  upsertReleaseSet as dbUpsert,
} from './database/release-set-db.js';
import type { ReleaseComponentConfig } from './projects.js';

export type ReleaseSetStatus = 'pending' | 'releasing' | 'passed' | 'failed' | 'partial' | 'rolled_back' | 'skipped';
export type ReleaseComponentStatus = 'pending' | 'releasing' | 'passed' | 'failed' | 'skipped' | 'blocked' | 'rolled_back';
export type ReleaseCheckStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
export type RollbackStatus = ReleaseCheckStatus | 'rolled_back';

export interface ReleaseComponentState {
  componentKey: string;
  provider?: string;
  trigger: ReleaseComponentConfig['trigger'];
  releaseOrder: number;
  required: boolean;
  status: ReleaseComponentStatus;
  healthStatus?: ReleaseCheckStatus;
  versionStatus?: ReleaseCheckStatus;
  smokeStatus?: ReleaseCheckStatus;
  rollbackStatus?: RollbackStatus;
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

export const upsertReleaseSet = (releaseSet: ReleaseSet): Effect.Effect<void, Error> =>
  Effect.try({
    try: () => upsertReleaseSetSync(releaseSet),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

export const getReleaseSet = (issueId: string): Effect.Effect<ReleaseSet | null, Error> =>
  Effect.try({
    try: () => getReleaseSetSync(issueId),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

export const getAllReleaseSets = (projectKey?: string): Effect.Effect<ReleaseSet[], Error> =>
  Effect.try({
    try: () => getAllReleaseSetsSync(projectKey),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

export const deleteReleaseSet = (issueId: string): Effect.Effect<void, Error> =>
  Effect.try({
    try: () => deleteReleaseSetSync(issueId),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

export const withComponentState = (
  releaseSet: ReleaseSet,
  componentKey: string,
  patch: Partial<ReleaseComponentState>,
): Effect.Effect<ReleaseSet> =>
  Effect.sync(() => withComponentStateSync(releaseSet, componentKey, patch));
