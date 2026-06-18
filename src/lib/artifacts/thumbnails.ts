import { access, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ArtifactMetadata } from '@overdeck/contracts';
import { getOverdeckHome } from '../paths.js';

export interface ArtifactThumbnailOptions {
  rawUrl?: string;
  width?: number;
  height?: number;
  timeoutMs?: number;
  renderer?: ArtifactThumbnailRenderer;
}

export type ArtifactThumbnailRenderer = (input: {
  rawUrl: string;
  outputPath: string;
  width: number;
  height: number;
  timeoutMs: number;
}) => Promise<void>;

export interface ArtifactThumbnailPlaceholder {
  kind: 'placeholder';
  contentType: 'image/svg+xml';
  body: string;
  error: string;
}

export type ArtifactThumbnailResult =
  | { kind: 'file'; path: string; cacheHit: boolean }
  | ArtifactThumbnailPlaceholder;

const DEFAULT_THUMBNAIL_WIDTH = 640;
const DEFAULT_THUMBNAIL_HEIGHT = 360;
const DEFAULT_THUMBNAIL_TIMEOUT_MS = 10_000;

export function getArtifactThumbnailDir(slug: string): string {
  return join(getOverdeckHome(), 'artifacts', 'thumbnails', slug);
}

export function getArtifactThumbnailPath(slug: string, publishedHash: string): string {
  return join(getArtifactThumbnailDir(slug), `${sanitizeHashForPath(publishedHash)}.png`);
}

export function resolveArtifactThumbnailUrl(artifact: ArtifactMetadata): string | undefined {
  const publishedHash = artifact.lastPublishedHash;
  if (!publishedHash) return undefined;
  return `/api/artifacts/${artifact.slug}/thumbnail?hash=${encodeURIComponent(publishedHash)}`;
}

export async function getOrCreateArtifactThumbnail(
  artifact: ArtifactMetadata,
  options: ArtifactThumbnailOptions = {},
): Promise<ArtifactThumbnailResult> {
  const publishedHash = artifact.lastPublishedHash;
  if (!publishedHash) {
    return placeholderThumbnail('Artifact has not been published');
  }

  const path = getArtifactThumbnailPath(artifact.slug, publishedHash);
  if (await fileExists(path)) return { kind: 'file', path, cacheHit: true };

  try {
    await mkdir(dirname(path), { recursive: true });
    await (options.renderer ?? renderArtifactThumbnailWithPlaywright)({
      rawUrl: options.rawUrl ?? defaultRawArtifactUrl(artifact.slug),
      outputPath: path,
      width: options.width ?? DEFAULT_THUMBNAIL_WIDTH,
      height: options.height ?? DEFAULT_THUMBNAIL_HEIGHT,
      timeoutMs: options.timeoutMs ?? DEFAULT_THUMBNAIL_TIMEOUT_MS,
    });
    return { kind: 'file', path, cacheHit: false };
  } catch (error) {
    return placeholderThumbnail(error instanceof Error ? error.message : String(error));
  }
}

export async function readPlaceholderThumbnail(error = 'Artifact thumbnail unavailable'): Promise<string> {
  return placeholderThumbnail(error).body;
}

async function renderArtifactThumbnailWithPlaywright(input: {
  rawUrl: string;
  outputPath: string;
  width: number;
  height: number;
  timeoutMs: number;
}): Promise<void> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: input.width, height: input.height },
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      await page.goto(input.rawUrl, { waitUntil: 'networkidle', timeout: input.timeoutMs });
      await page.screenshot({ path: input.outputPath, type: 'png', fullPage: false });
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

function defaultRawArtifactUrl(slug: string): string {
  const domain = process.env.PAN_ARTIFACT_DOMAIN ?? 'pan.localhost';
  return `https://artifacts.${domain}/a/${slug}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sanitizeHashForPath(hash: string): string {
  return hash.replace(/[^A-Za-z0-9._-]/g, '-');
}

function placeholderThumbnail(error: string): ArtifactThumbnailPlaceholder {
  const escaped = escapeXml(error.slice(0, 160));
  return {
    kind: 'placeholder',
    contentType: 'image/svg+xml',
    error,
    body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="Artifact thumbnail unavailable"><rect width="640" height="360" fill="#111827"/><rect x="24" y="24" width="592" height="312" rx="18" fill="#1f2937" stroke="#374151"/><text x="320" y="166" fill="#f9fafb" font-family="system-ui, sans-serif" font-size="24" text-anchor="middle">Thumbnail unavailable</text><text x="320" y="204" fill="#9ca3af" font-family="system-ui, sans-serif" font-size="16" text-anchor="middle">${escaped}</text></svg>`,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function readThumbnailFile(path: string): Promise<Buffer> {
  return readFile(path);
}
