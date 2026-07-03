import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  getProjectMappings,
  type ProjectMapping,
  readJsonBody,
  saveProjectMappings,
} from './shared.js';

// ─── Route: GET /api/project-mappings ────────────────────────────────────────

const getProjectMappingsRoute = HttpRouter.add(
  'GET',
  '/api/project-mappings',
  httpHandler(Effect.promise(() => getProjectMappings().then(m => jsonResponse(m)))),
);

// ─── Route: PUT /api/project-mappings ────────────────────────────────────────

const putProjectMappingsRoute = HttpRouter.add(
  'PUT',
  '/api/project-mappings',
  Effect.gen(function* () {
    const body = yield* readJsonBody;
    const mappings = body as ProjectMapping[];
    if (!Array.isArray(mappings)) {
      return jsonResponse({ error: 'Expected array of mappings' }, { status: 400 });
    }
    yield* Effect.promise(() => saveProjectMappings(mappings));
    return jsonResponse({ success: true, mappings });
  }),
);

// ─── Route: POST /api/project-mappings ───────────────────────────────────────

const postProjectMappingsRoute = HttpRouter.add(
  'POST',
  '/api/project-mappings',
  Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { linearProjectId, linearProjectName, linearPrefix, localPath } = body as Record<
      string,
      string | undefined
    >;

    if (!linearProjectId || !localPath) {
      return jsonResponse(
        { error: 'linearProjectId and localPath required' },
        { status: 400 },
      );
    }

    return yield* Effect.promise(async () => {
      try {
        const mappings = await getProjectMappings();
        const existing = mappings.findIndex(m => m.linearProjectId === linearProjectId);

        const mapping: ProjectMapping = {
          linearProjectId,
          linearProjectName: linearProjectName || '',
          linearPrefix: linearPrefix || '',
          localPath,
        };

        if (existing >= 0) {
          mappings[existing] = mapping;
        } else {
          mappings.push(mapping);
        }

        await saveProjectMappings(mappings);
        return jsonResponse({ success: true, mapping });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to save mapping: ' + msg }, { status: 500 });
      }
    });
  }),
);

export const projectMappingsRouteLayer = Layer.mergeAll(
  getProjectMappingsRoute,
  putProjectMappingsRoute,
  postProjectMappingsRoute,
);
