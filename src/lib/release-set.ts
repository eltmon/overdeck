import { Effect } from 'effect';
import {
  deleteReleaseSet as dbDelete,
  getAllReleaseSetsFromDb,
  getReleaseSetFromDb,
  upsertReleaseSet as dbUpsert,
} from './overdeck/release-sync.js';
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
