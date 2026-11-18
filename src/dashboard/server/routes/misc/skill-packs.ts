/**
 * Known skill packs for the dashboard (PAN-5540).
 *
 *   GET  /api/skills/packs/available            → { packs, groups }
 *   POST /api/skills/packs/preview  { id }       → 200 { preview }
 *   POST /api/skills/packs          { id, commit } → 201 { added: true, preview }
 *
 * GET returns `listAvailablePacks`: every known pack and pack group, what is added, and which the
 * dashboard may add. Preview fetches and extracts a dashboard-addable known pack without registering
 * it; add registers it through `addPack` only when its ref still resolves to the previewed commit
 * (D-2). The bodies accept a known pack id (and the commit) only, never a url, ref or adapter (FR-6).
 *
 * The routes have no ROUTE_SCOPES row, so a remote credential needs `admin` (the fail-closed default).
 * Errors answer `{ error, code }`.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { CORE_SKILLS } from '../../../../lib/skill-overrides/resolve.js';
import {
  addKnownPack,
  KnownPackError,
  listAvailablePacks,
  previewKnownPack,
  serializePackPreview,
  type KnownPackErrorCode,
} from '../../../../lib/skill-packs/known.js';
import { PACK_ID_PATTERN, PackSourceError, type PackSourceErrorCode } from '../../../../lib/skill-packs/sources.js';
import { jsonResponse } from '../../http-helpers.js';
import { readJsonBody } from './shared.js';

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const FORBIDDEN_KEYS = ['url', 'ref', 'adapter'] as const;

const KNOWN_PACK_STATUS: Record<KnownPackErrorCode, number> = {
  'bad-request': 400,
  'unknown-pack': 404,
  'not-addable': 422,
  busy: 409,
  'commit-changed': 409,
};

const PACK_SOURCE_STATUS: Record<PackSourceErrorCode, number> = {
  exists: 409,
  'bad-id': 400,
  'unknown-pack': 404,
  git: 502,
  render: 500,
};

function errorResponse(error: unknown) {
  if (error instanceof KnownPackError) {
    return jsonResponse({ error: error.message, code: error.code }, { status: KNOWN_PACK_STATUS[error.code] });
  }
  if (error instanceof PackSourceError) {
    return jsonResponse({ error: error.message, code: error.code }, { status: PACK_SOURCE_STATUS[error.code] });
  }
  console.error('[skill-packs] request failed:', error);
  return jsonResponse({ error: error instanceof Error ? error.message : String(error), code: 'internal' }, { status: 500 });
}

const badRequest = (message: string) => new KnownPackError('bad-request', message);

/** FR-6: `{ id }` naming a pack id, with no url, ref or adapter key. */
function parsePackId(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('body must be a JSON object');
  const record = body as Record<string, unknown>;
  if (FORBIDDEN_KEYS.some((key) => key in record)) throw badRequest('only a known pack id is accepted');
  const { id } = record;
  if (typeof id !== 'string' || !PACK_ID_PATTERN.test(id)) throw badRequest('id must be a pack id');
  return id;
}

function parseAddBody(body: unknown): { id: string; commit: string } {
  const id = parsePackId(body);
  const { commit } = body as Record<string, unknown>;
  if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) throw badRequest('commit must be the previewed 40-hex commit');
  return { id, commit };
}

const getAvailableRoute = HttpRouter.add(
  'GET',
  '/api/skills/packs/available',
  Effect.promise(async () => {
    try {
      return jsonResponse(await listAvailablePacks());
    } catch (error) {
      return errorResponse(error);
    }
  }),
);

const previewRoute = HttpRouter.add(
  'POST',
  '/api/skills/packs/preview',
  Effect.gen(function* () {
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      try {
        const preview = await previewKnownPack(parsePackId(body), CORE_SKILLS);
        return jsonResponse({ preview: serializePackPreview(preview) });
      } catch (error) {
        return errorResponse(error);
      }
    });
  }),
);

const addRoute = HttpRouter.add(
  'POST',
  '/api/skills/packs',
  Effect.gen(function* () {
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      try {
        const { id, commit } = parseAddBody(body);
        const preview = await addKnownPack(id, commit, CORE_SKILLS);
        return jsonResponse({ added: true, preview: serializePackPreview(preview) }, { status: 201 });
      } catch (error) {
        return errorResponse(error);
      }
    });
  }),
);

export const skillPacksRouteLayer = Layer.mergeAll(getAvailableRoute, previewRoute, addRoute);
