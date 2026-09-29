/**
 * Per-skill on/off overrides (PAN-3942).
 *
 *   GET /api/skills/overrides?project=<key>&issue=<id>
 *   PUT /api/skills/overrides  { level, skill, enabled: true|false|null, projectKey?, issueId? }
 *
 * Both return the effective state of every catalog skill for the context.
 * The global context (no project, no issue) also reports which projects and
 * issues override each skill below global.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  listLowerLevelOverrides,
  listSkillStates,
  parseSkillOverrideUpdate,
  setSkillOverride,
  SkillOverrideError,
  type SkillOverrideErrorCode,
} from '../../../../lib/skill-overrides/store.js';
import { jsonResponse } from '../../http-helpers.js';
import { readJsonBody } from './shared.js';

const STATUS_BY_CODE: Record<SkillOverrideErrorCode, number> = {
  'core-skill': 409,
  'unknown-skill': 404,
  'unknown-pack': 404,
  'unknown-project': 404,
  'unknown-issue': 404,
  'bad-request': 400,
};

function errorResponse(error: unknown) {
  if (error instanceof SkillOverrideError) {
    return jsonResponse({ error: error.message, code: error.code }, { status: STATUS_BY_CODE[error.code] });
  }
  console.error('[skill-overrides] request failed:', error);
  return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}

async function skillStatesResponseBody(ctx: { projectKey?: string; issueId?: string }) {
  const list = await listSkillStates(ctx);
  if (ctx.projectKey || ctx.issueId) return list;
  return { ...list, overriddenBelow: await listLowerLevelOverrides() };
}

const getSkillOverridesRoute = HttpRouter.add(
  'GET',
  '/api/skills/overrides',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const projectKey = url.searchParams.get('project') || undefined;
    const issueId = url.searchParams.get('issue') || undefined;
    return yield* Effect.promise(async () => {
      try {
        return jsonResponse(await skillStatesResponseBody({ projectKey, issueId }));
      } catch (error) {
        return errorResponse(error);
      }
    });
  }),
);

const putSkillOverridesRoute = HttpRouter.add(
  'PUT',
  '/api/skills/overrides',
  Effect.gen(function* () {
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      try {
        const update = parseSkillOverrideUpdate(body);
        const result = await setSkillOverride(update);
        const list = await skillStatesResponseBody({ projectKey: update.projectKey, issueId: update.issueId });
        return jsonResponse({ ok: true, ...result, ...list });
      } catch (error) {
        return errorResponse(error);
      }
    });
  }),
);

export const skillOverridesRouteLayer = Layer.mergeAll(getSkillOverridesRoute, putSkillOverridesRoute);
