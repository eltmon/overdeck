import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactMetadata } from '@overdeck/contracts';
import {
  getArtifactThumbnailPath,
  getOrCreateArtifactThumbnail,
  resolveArtifactThumbnailUrl,
} from '../../src/lib/artifacts/thumbnails.js';

const originalPanopticonHome = process.env.OVERDECK_HOME;

function metadata(overrides: Partial<ArtifactMetadata> = {}): ArtifactMetadata {
  return {
    artifactId: 'artifact-1',
    slug: 'AbCd123_',
    issueId: 'PAN-1205',
    workspaceId: 'feature-pan-1205-slot-2',
    agentRole: 'work',
    agentHarness: 'claude-code',
    runId: 'RUN-1',
    sessionId: 'session-1',
    filePath: '/workspace/report.html',
    currentHash: 'current-hash',
    lastPublishedHash: 'published/hash:1',
    supersedes: null,
    title: 'Report',
    description: null,
    createdAt: '2026-05-25T00:00:00.000Z',
    publishedAt: '2026-05-25T00:01:00.000Z',
    unsharedAt: null,
    ...overrides,
  };
}

describe('artifact thumbnails', () => {
  let panopticonHome: string;

  beforeEach(async () => {
    panopticonHome = await mkdtemp(join(tmpdir(), 'pan-artifact-thumbnails-'));
    process.env.OVERDECK_HOME = panopticonHome;
  });

  afterEach(async () => {
    process.env.OVERDECK_HOME = originalPanopticonHome;
    await rm(panopticonHome, { recursive: true, force: true });
  });

  it('uses artifact slug and published hash for the thumbnail cache key', () => {
    const path = getArtifactThumbnailPath('AbCd123_', 'published/hash:1');

    expect(path).toContain(join('artifacts', 'thumbnails', 'AbCd123_'));
    expect(basename(path)).toBe('published-hash-1.png');
    expect(resolveArtifactThumbnailUrl(metadata())).toBe('/api/artifacts/AbCd123_/thumbnail?hash=published%2Fhash%3A1');
  });

  it('renders once and reuses the cached thumbnail for unchanged published hashes', async () => {
    const renderer = vi.fn(async ({ outputPath }: { outputPath: string }) => {
      await writeFile(outputPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });

    const first = await getOrCreateArtifactThumbnail(metadata(), { rawUrl: 'https://artifacts.test/a/AbCd123_', renderer });
    const second = await getOrCreateArtifactThumbnail(metadata(), { rawUrl: 'https://artifacts.test/a/AbCd123_', renderer });

    expect(first).toMatchObject({ kind: 'file', cacheHit: false });
    expect(second).toMatchObject({ kind: 'file', cacheHit: true });
    expect(renderer).toHaveBeenCalledTimes(1);
    if (first.kind === 'file') {
      await expect(readFile(first.path)).resolves.toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
  });

  it('returns a placeholder when rendering fails', async () => {
    const result = await getOrCreateArtifactThumbnail(metadata(), {
      rawUrl: 'https://artifacts.test/a/AbCd123_',
      renderer: async () => {
        throw new Error('browser unavailable');
      },
    });

    expect(result).toMatchObject({ kind: 'placeholder', contentType: 'image/svg+xml', error: 'browser unavailable' });
    if (result.kind === 'placeholder') expect(result.body).toContain('Thumbnail unavailable');
  });
});
