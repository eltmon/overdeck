import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ArtifactDetailResponse,
  ArtifactListEntry,
  ArtifactUnshareResponse,
  WorkspaceArtifactsResponse,
} from '@panctl/contracts';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import type { ArtifactIndexEntry } from '../../../lib/artifacts/index-store.js';
import {
  getOrCreateArtifactThumbnail,
  resolveArtifactThumbnailUrl,
  type ArtifactThumbnailRenderer,
} from '../../../lib/artifacts/thumbnails.js';
import { getPanopticonHome } from '../../../lib/paths.js';
import { jsonResponse } from '../http-helpers.js';
import { runDashboardDbJob } from '../services/dashboard-db-task.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

const ARTIFACT_SLUG_PATTERN = /^[A-Za-z0-9_-]{8}$/;
const WORKSPACE_ARTIFACT_SELECTOR_PATTERN = /^[A-Za-z0-9._:-]+$/;
const RAW_ARTIFACT_CSP = [
  "default-src 'self' 'unsafe-inline' data: https:",
  "script-src 'self' 'unsafe-inline' data:",
  "style-src 'self' 'unsafe-inline' data: https:",
  "img-src 'self' data: https:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

type HeaderMap = Record<string, string | string[] | undefined>;
type ArtifactRouteBody = ArtifactDetailResponse | WorkspaceArtifactsResponse | ArtifactUnshareResponse | { error: string; slug?: string; issueId?: string };

export interface ArtifactRouteResult {
  status: number;
  body: ArtifactRouteBody;
}

export interface ArtifactRouteDeps {
  getBySlug?: (slug: string) => Promise<ArtifactIndexEntry | null>;
  listForWorkspaceOrIssue?: (selector: string) => Promise<ArtifactIndexEntry[]>;
  unshareBySlug?: (slug: string) => Promise<ArtifactIndexEntry | null>;
  thumbnailRenderer?: ArtifactThumbnailRenderer;
  readSnapshot?: (path: string) => Promise<string>;
  baseDomain?: string;
}

function isValidArtifactSlug(slug: string): boolean {
  return ARTIFACT_SLUG_PATTERN.test(slug);
}

function isValidWorkspaceArtifactSelector(selector: string): boolean {
  return WORKSPACE_ARTIFACT_SELECTOR_PATTERN.test(selector);
}

function headerValue(headers: HeaderMap, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function normalizedHost(value: string | undefined): string | null {
  if (!value) return null;
  const host = value.split(',', 1)[0]?.trim().toLowerCase();
  if (!host) return null;
  return host.startsWith('[') ? host : host.split(':', 1)[0] ?? null;
}

function artifactDomain(baseDomain?: string): string {
  const host = (baseDomain ?? process.env.PAN_ARTIFACT_DOMAIN ?? 'pan.localhost').replace(/^https?:\/\//, '').split('/', 1)[0]?.toLowerCase();
  if (!host) return 'pan.localhost';
  return host.startsWith('[') ? host : host.split(':', 1)[0] ?? host;
}

function isArtifactHost(headers: HeaderMap, baseDomain?: string): boolean {
  return normalizedHost(headerValue(headers, 'host')) === `artifacts.${artifactDomain(baseDomain)}`;
}

function getPublishedSnapshotPath(slug: string): string {
  return join(getPanopticonHome(), 'artifacts', 'snapshots', slug, 'index.html');
}

function resolveArtifactUrls(slug: string, baseDomain?: string) {
  const domain = baseDomain ?? process.env.PAN_ARTIFACT_DOMAIN ?? 'pan.localhost';
  return {
    wrapperUrl: `https://${domain}/s/${slug}`,
    rawUrl: `https://artifacts.${domain}/a/${slug}`,
  };
}

function toListEntry(entry: ArtifactIndexEntry, baseDomain?: string): ArtifactListEntry {
  return {
    artifact: entry.artifact,
    urls: resolveArtifactUrls(entry.artifact.slug, baseDomain),
    status: entry.status,
    pendingChanges: entry.pendingChanges,
    thumbnailUrl: resolveArtifactThumbnailUrl(entry.artifact),
  };
}

function toDetailResponse(entry: ArtifactIndexEntry, baseDomain?: string): ArtifactDetailResponse {
  return {
    artifact: entry.artifact,
    urls: resolveArtifactUrls(entry.artifact.slug, baseDomain),
    status: entry.status,
    pendingChanges: entry.pendingChanges,
  };
}

async function defaultGetBySlug(slug: string): Promise<ArtifactIndexEntry | null> {
  return runDashboardDbJob<ArtifactIndexEntry | null>('getArtifactBySlug', slug);
}

async function defaultListForWorkspaceOrIssue(selector: string): Promise<ArtifactIndexEntry[]> {
  return runDashboardDbJob<ArtifactIndexEntry[]>('listArtifactsForWorkspaceOrIssue', selector);
}

async function defaultUnshareBySlug(slug: string): Promise<ArtifactIndexEntry | null> {
  return runDashboardDbJob<ArtifactIndexEntry | null>('unshareArtifactBySlug', slug);
}

export type RawArtifactPayload =
  | { kind: 'json'; status: number; body: { error: string; slug?: string } }
  | { kind: 'html'; status: 200; body: string; headers: Record<string, string> };

export async function getRawArtifactPayload(
  slug: string,
  headers: HeaderMap,
  deps: ArtifactRouteDeps = {},
): Promise<RawArtifactPayload> {
  if (!isValidArtifactSlug(slug)) {
    return { kind: 'json', status: 400, body: { error: 'Artifact slug must be 8 URL-safe characters', slug } };
  }
  if (!isArtifactHost(headers, deps.baseDomain)) {
    return { kind: 'json', status: 404, body: { error: 'Artifact raw origin not found', slug } };
  }

  const entry = await (deps.getBySlug ?? defaultGetBySlug)(slug);
  if (!entry) return { kind: 'json', status: 404, body: { error: 'Artifact not found', slug } };
  if (entry.status === 'unshared') return { kind: 'json', status: 410, body: { error: 'Artifact is unshared', slug } };
  if (!entry.artifact.lastPublishedHash) return { kind: 'json', status: 404, body: { error: 'Artifact has no published snapshot', slug } };

  try {
    const body = await (deps.readSnapshot ?? ((path) => readFile(path, 'utf-8')))(getPublishedSnapshotPath(slug));
    return {
      kind: 'html',
      status: 200,
      body,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Security-Policy': RAW_ARTIFACT_CSP,
        'X-Content-Type-Options': 'nosniff',
      },
    };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return { kind: 'json', status: 404, body: { error: 'Artifact snapshot not found', slug } };
    throw error;
  }
}

export async function getArtifactDetailPayload(slug: string, deps: ArtifactRouteDeps = {}): Promise<ArtifactRouteResult> {
  if (!isValidArtifactSlug(slug)) {
    return { status: 400, body: { error: 'Artifact slug must be 8 URL-safe characters', slug } };
  }

  const entry = await (deps.getBySlug ?? defaultGetBySlug)(slug);
  if (!entry) return { status: 404, body: { error: 'Artifact not found', slug } };
  if (entry.status === 'unshared') return { status: 410, body: { error: 'Artifact is unshared', slug } };

  return { status: 200, body: toDetailResponse(entry, deps.baseDomain) };
}

export async function getWorkspaceArtifactsPayload(issueId: string, deps: ArtifactRouteDeps = {}): Promise<ArtifactRouteResult> {
  if (!isValidWorkspaceArtifactSelector(issueId)) {
    return { status: 400, body: { error: 'Workspace artifact selector contains invalid characters', issueId } };
  }

  const entries = await (deps.listForWorkspaceOrIssue ?? defaultListForWorkspaceOrIssue)(issueId);
  return {
    status: 200,
    body: {
      issueId,
      workspaceId: issueId,
      artifacts: entries.map((entry) => toListEntry(entry, deps.baseDomain)),
    },
  };
}

export async function postArtifactUnsharePayload(slug: string, deps: ArtifactRouteDeps = {}): Promise<ArtifactRouteResult> {
  if (!isValidArtifactSlug(slug)) {
    return { status: 400, body: { error: 'Artifact slug must be 8 URL-safe characters', slug } };
  }

  const existing = await (deps.getBySlug ?? defaultGetBySlug)(slug);
  if (!existing) return { status: 404, body: { error: 'Artifact not found', slug } };
  if (existing.status === 'unshared') return { status: 410, body: { error: 'Artifact is already unshared', slug } };

  const updated = await (deps.unshareBySlug ?? defaultUnshareBySlug)(slug);
  if (!updated) return { status: 404, body: { error: 'Artifact not found', slug } };
  return { status: 200, body: { artifact: updated.artifact, unshared: true } };
}

export type ArtifactThumbnailPayload =
  | { kind: 'json'; status: number; body: { error: string; slug?: string } }
  | { kind: 'file'; status: 200; path: string; cacheHit: boolean }
  | { kind: 'placeholder'; status: 200; contentType: 'image/svg+xml'; body: string; error: string };

export async function getArtifactThumbnailPayload(slug: string, deps: ArtifactRouteDeps = {}): Promise<ArtifactThumbnailPayload> {
  if (!isValidArtifactSlug(slug)) {
    return { kind: 'json', status: 400, body: { error: 'Artifact slug must be 8 URL-safe characters', slug } };
  }

  const entry = await (deps.getBySlug ?? defaultGetBySlug)(slug);
  if (!entry) return { kind: 'json', status: 404, body: { error: 'Artifact not found', slug } };
  if (entry.status === 'unshared') return { kind: 'json', status: 410, body: { error: 'Artifact is unshared', slug } };

  const thumbnail = await getOrCreateArtifactThumbnail(entry.artifact, {
    rawUrl: resolveArtifactUrls(entry.artifact.slug, deps.baseDomain).rawUrl,
    renderer: deps.thumbnailRenderer,
  });
  if (thumbnail.kind === 'file') return { kind: 'file', status: 200, path: thumbnail.path, cacheHit: thumbnail.cacheHit };
  return { kind: 'placeholder', status: 200, contentType: thumbnail.contentType, body: thumbnail.body, error: thumbnail.error };
}

const getRawArtifactRoute = HttpRouter.add(
  'GET',
  '/a/:slug',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const result = yield* Effect.promise(() => getRawArtifactPayload(params['slug'] ?? '', request.headers));
    if (result.kind === 'json') return jsonResponse(result.body, { status: result.status });
    return HttpServerResponse.text(result.body, {
      status: result.status,
      contentType: 'text/html; charset=utf-8',
      headers: result.headers,
    });
  })),
);

const getArtifactDetailRoute = HttpRouter.add(
  'GET',
  '/api/artifacts/:slug',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const result = yield* Effect.promise(() => getArtifactDetailPayload(params['slug'] ?? ''));
    return jsonResponse(result.body, { status: result.status });
  })),
);

const getWorkspaceArtifactsRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId/artifacts',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const result = yield* Effect.promise(() => getWorkspaceArtifactsPayload(params['issueId'] ?? ''));
    return jsonResponse(result.body, { status: result.status });
  })),
);

const getArtifactThumbnailRoute = HttpRouter.add(
  'GET',
  '/api/artifacts/:slug/thumbnail',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const result = yield* Effect.promise(() => getArtifactThumbnailPayload(params['slug'] ?? ''));
    if (result.kind === 'json') return jsonResponse(result.body, { status: result.status });
    if (result.kind === 'placeholder') {
      return HttpServerResponse.text(result.body, {
        status: result.status,
        contentType: result.contentType,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const response = yield* HttpServerResponse.file(result.path).pipe(
      Effect.catchAll(() => Effect.succeed(HttpServerResponse.text('', { status: 204 }))),
    );
    return HttpServerResponse.setHeader(response, 'Cache-Control', 'public, max-age=31536000, immutable');
  })),
);

const postArtifactUnshareRoute = HttpRouter.add(
  'POST',
  '/api/artifacts/:slug/unshare',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const result = yield* Effect.promise(() => postArtifactUnsharePayload(params['slug'] ?? ''));
    return jsonResponse(result.body, { status: result.status });
  })),
);

export const artifactsRouteLayer = Layer.mergeAll(
  getRawArtifactRoute,
  getArtifactDetailRoute,
  getWorkspaceArtifactsRoute,
  getArtifactThumbnailRoute,
  postArtifactUnshareRoute,
);

export default artifactsRouteLayer;
