/**
 * `POST /api/ui/open { path, line?, column?, dryRun? }` (PAN-5349 O-D3), operate.
 *
 * Resolves an absolute path to an explorer root and, unless `dryRun`,
 * publishes an `open-path` UI command to the open dashboard tabs. `pan open`
 * and the `/open` link call it. It only runs `realpath` and `stat` on the
 * given path: it never lists a directory or reads file contents (NFR-3).
 */
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, sep } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';
import { projectDeckKey, resolvePathRoot, type UiCommand, type UiOpenResolution } from '@overdeck/contracts';

import { listProjectsAsync } from '../../../lib/projects.js';
import { listWorkspaces } from '../../../lib/workspaces/resolver.js';
import { jsonResponse } from '../http-helpers.js';
import { resolveExplorerRoot } from '../services/explorer/roots.js';
import { publishUiCommand } from '../services/ui-commands.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';

export interface UiOpenDeps {
  listProjects: () => Promise<readonly { key: string; name?: string; path: string }[]>;
  listScratch: () => Promise<readonly { id: string; path: string }[]>;
  realpath: (path: string) => Promise<string>;
  stat: (path: string) => Promise<{ isDirectory(): boolean }>;
  resolveRoot: (rootId: string) => Promise<{ absPath: string; projectKey: string }>;
  publish: (cmd: UiCommand) => number;
}

const defaultDeps: UiOpenDeps = {
  listProjects: async () => (await listProjectsAsync()).map((p) => ({ key: p.key, name: p.config.name, path: p.config.path })),
  listScratch: async () =>
    listWorkspaces({ kind: 'scratch' })
      .filter((row) => !row.isArchived)
      .map((row) => ({ id: row.id, path: row.path })),
  realpath: (path) => realpath(path),
  stat: (path) => stat(path),
  resolveRoot: (rootId) => resolveExplorerRoot(rootId),
  publish: publishUiCommand,
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Realpath every candidate; a candidate whose path does not resolve is skipped. */
async function realCandidates<T extends { path: string }>(rows: readonly T[], real: UiOpenDeps['realpath']): Promise<T[]> {
  const resolved = await Promise.all(
    rows.map((row) => real(row.path).then((path) => [{ ...row, path }], () => [])),
  );
  return resolved.flat();
}

export async function handleUiOpen(
  body: Record<string, unknown>,
  overrides: Partial<UiOpenDeps> = {},
): Promise<HttpServerResponse.HttpServerResponse> {
  const deps = { ...defaultDeps, ...overrides };
  const path = body['path'];
  if (typeof path !== 'string' || !isAbsolute(path)) {
    return jsonResponse({ error: 'path-must-be-absolute' }, { status: 400 });
  }
  const { line, column } = body;
  if ((line !== undefined && !isPositiveInteger(line)) || (column !== undefined && !isPositiveInteger(column))) {
    return jsonResponse({ error: 'invalid-position' }, { status: 400 });
  }
  const dryRun = body['dryRun'] === true;

  let realPath: string;
  let kind: 'file' | 'dir';
  try {
    realPath = await deps.realpath(path);
    kind = (await deps.stat(realPath)).isDirectory() ? 'dir' : 'file';
  } catch {
    return jsonResponse({ error: 'not-found', path }, { status: 404 });
  }

  const [projectRows, scratchRows] = await Promise.all([deps.listProjects(), deps.listScratch()]);
  const [projects, scratch] = await Promise.all([
    realCandidates(projectRows, deps.realpath),
    realCandidates(scratchRows, deps.realpath),
  ]);
  let hit = resolvePathRoot(realPath, projects, scratch);
  // A scratch row may point at the primary checkout or outside the workspaces dir,
  // and resolveExplorerRoot refuses those (D-A4). Such a row must not shadow the
  // project, so a refused scratch root falls back to the project rules.
  let root: { absPath: string; projectKey: string } | null = null;
  if (hit.kind === 'root' && hit.rootId.startsWith('workspace:')) {
    root = await deps.resolveRoot(hit.rootId).catch(() => null);
    if (!root) hit = resolvePathRoot(realPath, projects, []);
  }
  if (hit.kind === 'outside') {
    const dir = kind === 'dir' ? realPath : dirname(realPath);
    return jsonResponse({ error: 'outside-projects', path, kind, suggestion: `pan project add ${dir}` }, { status: 404 });
  }
  const target = hit;
  const noRoot = () => jsonResponse({ error: 'no-root', path, projectKey: target.projectKey }, { status: 404 });
  if (target.kind === 'no-root') return noRoot();

  if (!root) {
    try {
      root = await deps.resolveRoot(target.rootId);
    } catch {
      return noRoot();
    }
  }
  const rel = relative(root.absPath, realPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return noRoot();

  // Decks are keyed by the project's name, root ids by its registered key (PAN-5398).
  const registered = projectRows.find((p) => p.key === root.projectKey);
  const resolution: UiOpenResolution = {
    projectKey: root.projectKey,
    deckKey: registered ? projectDeckKey(registered) : root.projectKey,
    rootId: target.rootId,
    relPath: rel.split(sep).join('/'),
    kind,
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
  };
  const delivered = dryRun ? 0 : deps.publish({ id: randomUUID(), type: 'open-path', resolution });
  return jsonResponse({ ...resolution, delivered });
}

export function makeUiOpenRoute(overrides: Partial<UiOpenDeps> = {}) {
  return HttpRouter.add(
    'POST',
    '/api/ui/open',
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const refused = rejectUnsafeDashboardMutationRequest(request);
      if (refused) return refused;
      const text = yield* request.text;
      let body: Record<string, unknown> = {};
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        return jsonResponse({ error: 'body is not JSON' }, { status: 400 });
      }
      return yield* Effect.promise(() => handleUiOpen(body, overrides));
    }),
  );
}

export const uiOpenRouteLayer = Layer.mergeAll(makeUiOpenRoute());
