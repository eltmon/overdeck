/**
 * Model preset routes (PAN-4400) — Effect HttpRouter.Layer.
 *
 * The routes are thin wrappers over src/lib/model-presets, the same lib the
 * `pan models preset` CLI calls, so both show one diff. Applying writes
 * through the preset's path-scoped door, never the whole-document settings
 * save.
 *
 *   GET  /api/model-presets             — presets, versions, last applied, undo availability
 *   GET  /api/model-presets/:id/plan    — the per-setting diff (read-only)
 *   POST /api/model-presets/:id/apply   — body { expectedDigest }
 *   POST /api/model-presets/undo        — restore the values the last apply replaced
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  ConfigChangedError,
  NoPresetUndoError,
  PresetBlockedError,
  PresetPlanStaleError,
  PresetValidationError,
  applyPreset,
  listPresetStatus,
  redactPresetApplyResult,
  undoLastPresetApply,
} from '../../../lib/model-presets/apply.js';
import { UnknownPresetError, planPresetApply, redactPresetPlan } from '../../../lib/model-presets/plan.js';
import { jsonResponse } from '../http-helpers.js';
import { refreshTtsRuntimeConfig } from '../services/tts-runtime-config.js';
import { syncTtsPlaybackWithConfig } from '../services/tts-playback.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {};
  }
});

/** Maps the preset lib's typed errors to HTTP statuses; anything else stays a 500. */
function presetErrorResponse(err: unknown) {
  if (err instanceof UnknownPresetError) return jsonResponse({ error: err.message, code: 'unknown-preset' }, { status: 404 });
  if (err instanceof PresetBlockedError || err instanceof PresetPlanStaleError || err instanceof ConfigChangedError || err instanceof NoPresetUndoError) {
    return jsonResponse({ error: err.message, code: err.code }, { status: 409 });
  }
  if (err instanceof PresetValidationError) return jsonResponse({ error: err.message, code: err.code, errors: err.errors }, { status: 400 });
  throw err;
}

async function syncRuntimeWithConfig(): Promise<void> {
  await refreshTtsRuntimeConfig();
  await syncTtsPlaybackWithConfig();
}

const listModelPresetsRoute = HttpRouter.add(
  'GET',
  '/api/model-presets',
  httpHandler(Effect.promise(async () => jsonResponse(await listPresetStatus()))),
);

const getModelPresetPlanRoute = HttpRouter.add(
  'GET',
  '/api/model-presets/:id/plan',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    return yield* Effect.promise(async () => {
      try {
        return jsonResponse(redactPresetPlan(await planPresetApply(id)));
      } catch (err) {
        return presetErrorResponse(err);
      }
    });
  })),
);

const applyModelPresetRoute = HttpRouter.add(
  'POST',
  '/api/model-presets/:id/apply',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
      const expectedDigest = (body as { expectedDigest?: unknown } | null)?.expectedDigest;
      if (typeof expectedDigest !== 'string' || expectedDigest === '') {
        return jsonResponse({ error: 'expectedDigest is required: preview the plan, then apply it with its digest' }, { status: 400 });
      }
      try {
        const result = await applyPreset(id, { expectedDigest });
        await syncRuntimeWithConfig();
        return jsonResponse(redactPresetApplyResult(result));
      } catch (err) {
        return presetErrorResponse(err);
      }
    });
  })),
);

const undoModelPresetRoute = HttpRouter.add(
  'POST',
  '/api/model-presets/undo',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    return yield* Effect.promise(async () => {
      try {
        const result = await undoLastPresetApply();
        await syncRuntimeWithConfig();
        return jsonResponse(result);
      } catch (err) {
        return presetErrorResponse(err);
      }
    });
  })),
);

export const modelPresetsRouteLayer = Layer.mergeAll(
  listModelPresetsRoute,
  getModelPresetPlanRoute,
  applyModelPresetRoute,
  undoModelPresetRoute,
);
