/**
 * Owner project facts and files for "Add this project" (PAN-4651 FR-4,
 * D-4651-14, NFR-6).
 *
 * - `GET /api/machines/projects/:key/source` → `{ key, name, issuePrefix,
 *   gitOrigin, cloneUrl, ignoredFiles: [{ path, bytes, preselected }] }`.
 * - `GET /api/machines/projects/:key/file?path=` → the file's raw bytes.
 *
 * Project files hold secrets, so both routes answer only a machine credential
 * whose link is operator-level and whose actor is the operator; anything else
 * is 403 `project-files-forbidden`. Paths go through `resolveProjectFile`
 * (no absolute paths, `..`, symlinks or escapes from the project root).
 */
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { gitOriginOf } from '../../../lib/anywhere/project-origin.js';
import { getIssuePrefix, getProjectSync, type ProjectConfig } from '../../../lib/projects.js';
import { listIgnoredFiles, ProjectFileError, projectCloneUrl, readProjectFile } from '../../../lib/projects/ignored-files.js';
import { jsonResponse } from '../http-helpers.js';
import { type DashboardCredential, resolveRequestCredential } from './dashboard-auth.js';

export const PROJECT_FILES_FORBIDDEN = 'project-files-forbidden';

/** Null when the caller may read project files; else the 403. */
export function projectFilesRefusal(credential: DashboardCredential | null): HttpServerResponse.HttpServerResponse | null {
  if (credential?.kind === 'machine' && credential.access === 'operator' && credential.actor === 'operator') return null;
  return jsonResponse({
    code: PROJECT_FILES_FORBIDDEN,
    error: 'Project files cross only an operator-level link, for the operator (not an agent)',
  }, { status: 403 });
}

export interface MachineProjectsDeps {
  project: (key: string) => ProjectConfig | null;
  ignoredFiles: typeof listIgnoredFiles;
  cloneUrl: typeof projectCloneUrl;
  readFile: typeof readProjectFile;
}

const defaultDeps: MachineProjectsDeps = {
  project: getProjectSync,
  ignoredFiles: (root) => listIgnoredFiles(root),
  cloneUrl: (root, gitOrigin) => projectCloneUrl(root, gitOrigin),
  readFile: readProjectFile,
};

const unknownProject = (key: string) => jsonResponse({ code: 'unknown-project', error: `No project ${key} on this machine` }, { status: 404 });

/** This machine's source facts for a project; null when there is no such project. */
export async function projectSourceFacts(key: string, deps: MachineProjectsDeps = defaultDeps) {
  const project = deps.project(key);
  if (!project?.path) return null;
  const gitOrigin = gitOriginOf(project);
  const [cloneUrl, ignoredFiles] = await Promise.all([
    deps.cloneUrl(project.path, gitOrigin),
    deps.ignoredFiles(project.path).catch(() => []),
  ]);
  return { key, name: project.name || key, issuePrefix: getIssuePrefix(project) ?? null, gitOrigin, cloneUrl, ignoredFiles, root: project.path };
}

export async function handleProjectSource(credential: DashboardCredential | null, key: string, deps: MachineProjectsDeps = defaultDeps): Promise<HttpServerResponse.HttpServerResponse> {
  const refused = projectFilesRefusal(credential);
  if (refused) return refused;
  const facts = await projectSourceFacts(key, deps);
  if (!facts) return unknownProject(key);
  const { root: _root, ...source } = facts;
  return jsonResponse(source);
}

export async function handleProjectFile(credential: DashboardCredential | null, key: string, path: string, deps: MachineProjectsDeps = defaultDeps): Promise<HttpServerResponse.HttpServerResponse> {
  const refused = projectFilesRefusal(credential);
  if (refused) return refused;
  const project = deps.project(key);
  if (!project?.path) return unknownProject(key);
  try {
    const bytes = await deps.readFile(project.path, path);
    return HttpServerResponse.uint8Array(new Uint8Array(bytes), { contentType: 'application/octet-stream' });
  } catch (error) {
    if (error instanceof ProjectFileError) return jsonResponse({ code: error.code, error: error.message }, { status: error.code === 'not-found' ? 404 : 400 });
    throw error;
  }
}

const sourceRoute = HttpRouter.add(
  'GET',
  '/api/machines/projects/:key/source',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const key = (yield* HttpRouter.params)['key'] ?? '';
    return yield* Effect.promise(() => handleProjectSource(resolveRequestCredential(request), key));
  }),
);

const fileRoute = HttpRouter.add(
  'GET',
  '/api/machines/projects/:key/file',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const key = (yield* HttpRouter.params)['key'] ?? '';
    const url = HttpServerRequest.toURL(request);
    const path = Option.isSome(url) ? url.value.searchParams.get('path') ?? '' : '';
    return yield* Effect.promise(() => handleProjectFile(resolveRequestCredential(request), key, path));
  }),
);

export const machinesProjectsRouteLayer = Layer.mergeAll(sourceRoute, fileRoute);
