/**
 * Filesystem route module — Effect HttpRouter.Layer
 *
 *   GET /api/fs/list-dirs?path=<abs>   — list immediate subdirectories, home-clamped + auth-gated
 */

import { readdir, realpath } from 'node:fs/promises';
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
    const params = new URL(req.url, 'http://localhost').searchParams;
    const rawPath = params.get('path');

    return yield* Effect.promise(async () => {
      // Canonicalize home to resolve any symlinks in the home path itself.
      let canonicalHome: string;
      try { canonicalHome = await realpath(home); }
      catch { canonicalHome = home; }

      const isWithinHome = (p: string) =>
        p === canonicalHome ||
        p.startsWith(canonicalHome.endsWith(sep) ? canonicalHome : `${canonicalHome}${sep}`);

      // Resolve and canonicalize the requested path (follows symlinks → detects escapes).
      const rawResolved = rawPath ? resolve(normalize(rawPath)) : home;
      let target: string;
      try { target = await realpath(rawResolved); }
      catch { return jsonResponse({ error: 'Path does not exist' }, { status: 400 }); }

      if (!isWithinHome(target)) {
        return jsonResponse({ error: 'Path is outside home directory' }, { status: 400 });
      }

      const parent = target === canonicalHome ? null : resolve(target, '..');

      const dirents = await readdir(target, { withFileTypes: true });
      const entries = dirents
        .filter((d) => d.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => ({ name: d.name, path: resolve(target, d.name) }));

      return jsonResponse({ path: target, parent, entries });
    });
  })),
);

// ─── Layer composition ────────────────────────────────────────────────────────

export const fsRouteLayer = Layer.mergeAll(listDirsRoute);
