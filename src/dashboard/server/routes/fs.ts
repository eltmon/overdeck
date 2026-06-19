/**
 * Filesystem route module — Effect HttpRouter.Layer
 *
 *   GET /api/fs/list-dirs?path=<abs>   — list immediate subdirectories, home-clamped + auth-gated
 */

import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, normalize, sep } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { rejectUnauthorizedDashboardRequest } from './dashboard-auth.js';

// ─── GET /api/fs/list-dirs ────────────────────────────────────────────────────

const listDirsRoute = HttpRouter.add(
  'GET',
  '/api/fs/list-dirs',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(req);
    if (authError) return authError;

    const home = homedir();
    const isWithinHome = (p: string) =>
      p === home ||
      p.startsWith(home.endsWith(sep) ? home : `${home}${sep}`);

    const params = new URL(req.url, 'http://localhost').searchParams;
    const rawPath = params.get('path');
    const target = rawPath ? resolve(normalize(rawPath)) : home;

    if (!isWithinHome(target)) {
      return jsonResponse({ error: 'Path is outside home directory' }, { status: 400 });
    }

    const parent = target === home ? null : resolve(target, '..');

    const entries = yield* Effect.promise(async () => {
      const dirents = await readdir(target, { withFileTypes: true });
      return dirents
        .filter((d) => d.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => ({ name: d.name, path: resolve(target, d.name) }));
    });

    return jsonResponse({ path: target, parent, entries });
  })),
);

// ─── Layer composition ────────────────────────────────────────────────────────

export const fsRouteLayer = Layer.mergeAll(listDirsRoute);
