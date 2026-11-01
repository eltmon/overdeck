/**
 * Color theme routes (PAN-4644) — Effect HttpRouter.Layer, modeled on routes/jev.ts.
 *
 *   GET  /api/color-themes                  — { themes, selection: { light, dark }, warnings }
 *   PUT  /api/color-themes/selection         — body { mode, id }
 *   POST /api/color-themes/import/preview    — body { fileName, contentBase64 }; writes nothing
 *   POST /api/color-themes                  — body { theme }
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { slugifyThemeId, type ColorThemeType } from '@overdeck/contracts';

import { getColorTheme, listColorThemes, saveColorTheme } from '../../../lib/color-themes/store.js';
import { resolveColorThemeSelection } from '../../../lib/color-themes/selection.js';
import { saveColorThemeSelection } from '../../../lib/color-themes/selection-write.js';
import { ColorThemeImportError, mapVsCodeTheme } from '../../../lib/color-themes/vscode-import.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {};
  }
});

const getColorThemesRoute = HttpRouter.add(
  'GET',
  '/api/color-themes',
  httpHandler(Effect.promise(async () => {
    const [{ themes, warnings }, selection] = await Promise.all([listColorThemes(), resolveColorThemeSelection()]);
    return jsonResponse({ themes, selection: { light: selection.light.id, dark: selection.dark.id }, warnings });
  })),
);

const putColorThemeSelectionRoute = HttpRouter.add(
  'PUT',
  '/api/color-themes/selection',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
      const { mode, id } = (body ?? {}) as { mode?: unknown; id?: unknown };
      if (mode !== 'light' && mode !== 'dark') {
        return jsonResponse({ error: 'mode must be "light" or "dark"' }, { status: 400 });
      }
      if (typeof id !== 'string') {
        return jsonResponse({ error: 'id is required' }, { status: 400 });
      }
      const theme = await getColorTheme(id);
      if (theme === undefined || theme.type !== mode) {
        return jsonResponse({ error: `id "${id}" does not name a ${mode} theme` }, { status: 400 });
      }
      await saveColorThemeSelection(mode as ColorThemeType, id);
      const selection = await resolveColorThemeSelection();
      return jsonResponse({ selection: { light: selection.light.id, dark: selection.dark.id } });
    });
  })),
);

const postColorThemeImportPreviewRoute = HttpRouter.add(
  'POST',
  '/api/color-themes/import/preview',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
      const { fileName, contentBase64 } = (body ?? {}) as { fileName?: unknown; contentBase64?: unknown };
      if (typeof fileName !== 'string' || !/\.json$/i.test(fileName)) {
        return jsonResponse(
          { error: 'Only VS Code theme .json files are supported; .vsix import is tracked in #4659' },
          { status: 400 },
        );
      }
      if (typeof contentBase64 !== 'string') {
        return jsonResponse({ error: 'contentBase64 is required' }, { status: 400 });
      }
      const decoded = Buffer.from(contentBase64, 'base64');
      if (decoded.byteLength > MAX_IMPORT_BYTES) {
        return jsonResponse({ error: 'theme file exceeds the 2 MB import limit' }, { status: 413 });
      }
      try {
        const { theme, warnings } = mapVsCodeTheme(decoded.toString('utf8'), fileName);
        const proposedId = slugifyThemeId(theme.name);
        return jsonResponse({ themes: [{ ...theme, id: proposedId }], warnings });
      } catch (err) {
        if (err instanceof ColorThemeImportError) {
          return jsonResponse({ error: err.message }, { status: 400 });
        }
        throw err;
      }
    });
  })),
);

const postColorThemeRoute = HttpRouter.add(
  'POST',
  '/api/color-themes',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
      const { theme } = (body ?? {}) as { theme?: unknown };
      const result = await saveColorTheme(theme);
      if ('errors' in result) {
        return jsonResponse({ errors: result.errors }, { status: 400 });
      }
      return jsonResponse({ theme: result.theme });
    });
  })),
);

export const colorThemesRouteLayer = Layer.mergeAll(
  getColorThemesRoute,
  putColorThemeSelectionRoute,
  postColorThemeImportPreviewRoute,
  postColorThemeRoute,
);
