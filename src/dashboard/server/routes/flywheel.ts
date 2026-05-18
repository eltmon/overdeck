import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { validateOrigin } from './origin-validation.js';

const DEFAULT_BRIEF_PATH = 'docs/flywheel-brief.md';

interface BriefRequestBody {
  content?: unknown;
  path?: unknown;
}

function requireTrustedOrigin(request: HttpServerRequest.HttpServerRequest) {
  const originCheck = validateOrigin(request);
  return originCheck.ok ? null : jsonResponse({ error: originCheck.error }, { status: 403 });
}

function isInsideRoot(projectRoot: string, candidate: string): boolean {
  const relativePath = relative(projectRoot, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

export function resolveFlywheelBriefPath(projectRoot: string, requestedPath?: string): { ok: true; path: string } | { ok: false; error: string } {
  const rawPath = requestedPath?.trim() || DEFAULT_BRIEF_PATH;
  if (rawPath.includes('\0')) {
    return { ok: false, error: 'Brief path is invalid' };
  }

  const root = resolve(projectRoot);
  const resolvedPath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(root, rawPath);
  if (!isInsideRoot(root, resolvedPath)) {
    return { ok: false, error: 'Brief path must stay inside the project root' };
  }

  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  const displayPath = resolvedPath === root ? '.' : relative(root, resolvedPath);
  return { ok: true, path: resolvedPath.startsWith(normalizedRoot) ? displayPath : resolvedPath };
}

function resolveBriefAbsolutePath(projectRoot: string, requestedPath?: string): { ok: true; absolutePath: string; displayPath: string } | { ok: false; error: string } {
  const resolved = resolveFlywheelBriefPath(projectRoot, requestedPath);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    absolutePath: resolve(projectRoot, resolved.path),
    displayPath: resolved.path,
  };
}

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return { ok: true as const, body: text ? (JSON.parse(text) as BriefRequestBody) : {} };
  } catch {
    return { ok: false as const, error: 'Request body must be valid JSON' };
  }
});

const getFlywheelBriefRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/brief',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const requestedPath = HttpServerRequest.toURL(request).pipe(Option.match({
      onNone: () => undefined,
      onSome: (url) => url.searchParams.get('path') ?? undefined,
    }));
    const resolved = resolveBriefAbsolutePath(process.cwd(), requestedPath);
    if (!resolved.ok) return jsonResponse({ error: resolved.error }, { status: 400 });

    return yield* Effect.promise(async () => {
      try {
        const content = await readFile(resolved.absolutePath, 'utf8');
        return jsonResponse({ path: resolved.displayPath, content });
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        if (code === 'ENOENT') {
          return jsonResponse({ error: 'Flywheel brief not found', path: resolved.displayPath }, { status: 404 });
        }
        throw error;
      }
    });
  })),
);

const postFlywheelBriefRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/brief',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    const parsed = yield* readJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    const body = parsed.body;
    if (typeof body.content !== 'string') {
      return jsonResponse({ error: 'content must be a string' }, { status: 400 });
    }
    if (body.path !== undefined && typeof body.path !== 'string') {
      return jsonResponse({ error: 'path must be a string when provided' }, { status: 400 });
    }

    const resolved = resolveBriefAbsolutePath(process.cwd(), body.path);
    if (!resolved.ok) return jsonResponse({ error: resolved.error }, { status: 400 });

    return yield* Effect.promise(async () => {
      await mkdir(dirname(resolved.absolutePath), { recursive: true });
      await writeFile(resolved.absolutePath, body.content, 'utf8');
      return jsonResponse({ ok: true, path: resolved.displayPath });
    });
  })),
);

export const flywheelRouteLayer = Layer.mergeAll(
  getFlywheelBriefRoute,
  postFlywheelBriefRoute,
);

export default flywheelRouteLayer;
