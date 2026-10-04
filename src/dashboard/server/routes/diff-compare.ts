/**
 * Two-ref diff compare routes (PAN-4503).
 *
 * GET /api/diffs/compare?repo=&base=&head=&mode=&file=&ignoreWhitespace=
 *   — files changed between two refs of an allowed local repository; the
 *     patch for one file when `file` is given. No remote or PR required.
 * GET /api/diffs/refs?repo=
 *   — branches, tags and recent commits for the compare picker.
 *
 * Refs are shape-checked before the repository is resolved or any git process
 * starts; see src/lib/diffs/compare.ts for the allowed-roots rule.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import {
  compareRefs,
  listRepoRefs,
  parseCompareMode,
  resolveAllowedDiffRoots,
  resolveCommit,
  resolveCompareRepo,
  validateRefShape,
  type AllowedDiffRoots,
  type CompareError,
} from '../../../lib/diffs/compare.js';
import { diffOptionsFromSearchParams } from '../../../lib/diffs/diff-output.js';
import { jsonResponse } from '../http-helpers.js';
import { validateOrigin } from './origin-validation.js';

export interface DiffCompareRouteDependencies {
  allowedRoots: () => Promise<AllowedDiffRoots>;
}

function failureResponse(failure: CompareError) {
  return jsonResponse(failure, { status: 400 });
}

async function handleCompare(url: URL, deps: DiffCompareRouteDependencies) {
  const params = url.searchParams;
  const mode = parseCompareMode(params.get('mode'));
  if (!mode.ok) return failureResponse(mode.failure);
  const base = validateRefShape(params.get('base'));
  if (!base.ok) return failureResponse(base.failure);
  const head = validateRefShape(params.get('head'));
  if (!head.ok) return failureResponse(head.failure);

  const repo = await resolveCompareRepo(params.get('repo'), await deps.allowedRoots());
  if (!repo.ok) return failureResponse(repo.failure);

  const baseSha = await resolveCommit(repo.value, base.value);
  if (!baseSha.ok) return failureResponse(baseSha.failure);
  const headSha = await resolveCommit(repo.value, head.value);
  if (!headSha.ok) return failureResponse(headSha.failure);

  const result = await compareRefs({
    repoRoot: repo.value,
    base: { ref: base.value, sha: baseSha.value },
    head: { ref: head.value, sha: headSha.value },
    mode: mode.value,
    file: params.get('file') || undefined,
    options: diffOptionsFromSearchParams(params),
  });
  return result.ok ? jsonResponse(result.value) : failureResponse(result.failure);
}

export function createDiffCompareRoutes(deps: DiffCompareRouteDependencies) {
  const compareRoute = HttpRouter.add(
    'GET',
    '/api/diffs/compare',
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const originCheck = validateOrigin(request);
      if (!originCheck.ok) {
        return jsonResponse({ error: originCheck.error }, { status: 403 });
      }
      const url = new URL(request.url, 'http://localhost');
      return yield* Effect.promise(async () => {
        try {
          return await handleCompare(url, deps);
        } catch (error: unknown) {
          console.error('[diff-compare] compare failed:', error instanceof Error ? error.message : String(error));
          return jsonResponse({ error: 'Internal server error' }, { status: 500 });
        }
      });
    }),
  );

  const refsRoute = HttpRouter.add(
    'GET',
    '/api/diffs/refs',
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const originCheck = validateOrigin(request);
      if (!originCheck.ok) {
        return jsonResponse({ error: originCheck.error }, { status: 403 });
      }
      const url = new URL(request.url, 'http://localhost');
      return yield* Effect.promise(async () => {
        try {
          const repo = await resolveCompareRepo(url.searchParams.get('repo'), await deps.allowedRoots());
          if (!repo.ok) return failureResponse(repo.failure);
          return jsonResponse(await listRepoRefs(repo.value));
        } catch (error: unknown) {
          console.error('[diff-compare] refs failed:', error instanceof Error ? error.message : String(error));
          return jsonResponse({ error: 'Internal server error' }, { status: 500 });
        }
      });
    }),
  );

  return Layer.mergeAll(compareRoute, refsRoute);
}

export const diffCompareRouteLayer = createDiffCompareRoutes({ allowedRoots: resolveAllowedDiffRoots });
