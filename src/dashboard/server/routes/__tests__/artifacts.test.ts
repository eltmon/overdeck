import { describe, expect, it } from 'vitest';
import type { ArtifactIndexEntry } from '../../../../lib/artifacts/index-store.js';
import {
  getArtifactDetailPayload,
  getArtifactThumbnailPayload,
  getRawArtifactPayload,
  getWorkspaceArtifactsPayload,
  postArtifactUnsharePayload,
} from '../artifacts.js';

function artifactEntry(overrides: Partial<ArtifactIndexEntry['artifact']> = {}, status: ArtifactIndexEntry['status'] = 'published'): ArtifactIndexEntry {
  const artifact = {
    artifactId: 'artifact-1',
    slug: 'AbCd123_',
    issueId: 'PAN-1205',
    workspaceId: 'feature-pan-1205-slot-2',
    agentRole: 'work' as const,
    agentHarness: 'claude-code' as const,
    runId: 'RUN-1',
    sessionId: 'session-1',
    filePath: '/workspace/report.html',
    currentHash: 'sha256-current',
    lastPublishedHash: 'sha256-current',
    supersedes: null,
    title: 'Artifact report',
    description: 'Dashboard preview',
    createdAt: '2026-05-25T00:00:00.000Z',
    publishedAt: '2026-05-25T00:01:00.000Z',
    unsharedAt: status === 'unshared' ? '2026-05-25T00:02:00.000Z' : null,
    ...overrides,
  };
  return {
    artifact,
    status,
    pendingChanges: status === 'pending_changes',
  };
}

describe('artifact route payloads', () => {
  it('returns artifact metadata, status, URLs, and pendingChanges without raw HTML', async () => {
    const result = await getArtifactDetailPayload('AbCd123_', {
      baseDomain: 'artifacts.test',
      getBySlug: async () => artifactEntry(),
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      artifact: {
        artifactId: 'artifact-1',
        slug: 'AbCd123_',
        issueId: 'PAN-1205',
        workspaceId: 'feature-pan-1205-slot-2',
      },
      status: 'published',
      pendingChanges: false,
      urls: {
        wrapperUrl: 'https://artifacts.test/s/AbCd123_',
        rawUrl: 'https://artifacts.artifacts.test/a/AbCd123_',
      },
    });
    expect(JSON.stringify(result.body)).not.toContain('<html');
  });

  it('maps invalid, missing, and unshared artifact detail requests to route statuses', async () => {
    await expect(getArtifactDetailPayload('bad')).resolves.toMatchObject({ status: 400 });
    await expect(getArtifactDetailPayload('AbCd123_', { getBySlug: async () => null })).resolves.toMatchObject({ status: 404 });
    await expect(getArtifactDetailPayload('AbCd123_', { getBySlug: async () => artifactEntry({}, 'unshared') })).resolves.toMatchObject({ status: 410 });
  });

  it('returns artifacts matching the workspace or issue selector with provenance fields', async () => {
    const result = await getWorkspaceArtifactsPayload('PAN-1205', {
      baseDomain: 'pan.test',
      listForWorkspaceOrIssue: async () => [
        artifactEntry({ artifactId: 'workspace-artifact', slug: 'Work1234', workspaceId: 'PAN-1205', issueId: 'PAN-1' }),
        artifactEntry({ artifactId: 'issue-artifact', slug: 'Issu1234', workspaceId: 'feature-pan-1205-slot-2', issueId: 'PAN-1205' }, 'pending_changes'),
      ],
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      issueId: 'PAN-1205',
      workspaceId: 'PAN-1205',
      artifacts: [
        {
          artifact: { artifactId: 'workspace-artifact', workspaceId: 'PAN-1205', issueId: 'PAN-1', agentRole: 'work' },
          status: 'published',
          pendingChanges: false,
          thumbnailUrl: '/api/artifacts/Work1234/thumbnail?hash=sha256-current',
        },
        {
          artifact: { artifactId: 'issue-artifact', workspaceId: 'feature-pan-1205-slot-2', issueId: 'PAN-1205', agentHarness: 'claude-code' },
          status: 'pending_changes',
          pendingChanges: true,
          thumbnailUrl: '/api/artifacts/Issu1234/thumbnail?hash=sha256-current',
        },
      ],
    });
  });

  it('rejects invalid workspace artifact selectors', async () => {
    await expect(getWorkspaceArtifactsPayload('../PAN-1205')).resolves.toMatchObject({ status: 400 });
  });

  it('serves raw artifact HTML only from the artifact host with sandbox headers', async () => {
    const result = await getRawArtifactPayload('AbCd123_', { host: 'artifacts.pan.test' }, {
      baseDomain: 'pan.test',
      getBySlug: async () => artifactEntry(),
      readSnapshot: async () => '<html><body>artifact</body></html>',
    });

    expect(result).toMatchObject({
      kind: 'html',
      status: 200,
      body: '<html><body>artifact</body></html>',
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
    const csp = result.kind === 'html' ? result.headers['Content-Security-Policy'] : '';
    expect(csp).toContain("default-src 'self' 'unsafe-inline' data: https:");
    expect(csp).toContain("connect-src 'none'");
  });

  it('rejects raw artifact requests from the dashboard host', async () => {
    await expect(getRawArtifactPayload('AbCd123_', { host: 'pan.test' }, { baseDomain: 'pan.test' })).resolves.toMatchObject({
      kind: 'json',
      status: 404,
    });
  });

  it('maps invalid, missing, unshared, and missing-snapshot raw artifact requests to statuses', async () => {
    const artifactHost = { host: 'artifacts.pan.test' };
    await expect(getRawArtifactPayload('bad', artifactHost, { baseDomain: 'pan.test' })).resolves.toMatchObject({ kind: 'json', status: 400 });
    await expect(getRawArtifactPayload('AbCd123_', artifactHost, {
      baseDomain: 'pan.test',
      getBySlug: async () => null,
    })).resolves.toMatchObject({ kind: 'json', status: 404 });
    await expect(getRawArtifactPayload('AbCd123_', artifactHost, {
      baseDomain: 'pan.test',
      getBySlug: async () => artifactEntry({}, 'unshared'),
    })).resolves.toMatchObject({ kind: 'json', status: 410 });
    await expect(getRawArtifactPayload('AbCd123_', artifactHost, {
      baseDomain: 'pan.test',
      getBySlug: async () => artifactEntry({ lastPublishedHash: null }),
    })).resolves.toMatchObject({ kind: 'json', status: 404 });
    await expect(getRawArtifactPayload('AbCd123_', artifactHost, {
      baseDomain: 'pan.test',
      getBySlug: async () => artifactEntry(),
      readSnapshot: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
    })).resolves.toMatchObject({ kind: 'json', status: 404 });
  });

  it('returns a thumbnail placeholder for artifacts without a published hash', async () => {
    const placeholder = await getArtifactThumbnailPayload('AbCd123_', {
      getBySlug: async () => artifactEntry({ lastPublishedHash: null }),
    });

    expect(placeholder).toMatchObject({ kind: 'placeholder', status: 200, contentType: 'image/svg+xml' });
  });

  it('maps invalid, missing, and unshared thumbnail requests to route statuses', async () => {
    await expect(getArtifactThumbnailPayload('bad')).resolves.toMatchObject({ kind: 'json', status: 400 });
    await expect(getArtifactThumbnailPayload('AbCd123_', { getBySlug: async () => null })).resolves.toMatchObject({ kind: 'json', status: 404 });
    await expect(getArtifactThumbnailPayload('AbCd123_', { getBySlug: async () => artifactEntry({}, 'unshared') })).resolves.toMatchObject({ kind: 'json', status: 410 });
  });

  it('unshares artifacts by slug while preserving metadata', async () => {
    const result = await postArtifactUnsharePayload('AbCd123_', {
      getBySlug: async () => artifactEntry(),
      unshareBySlug: async () => artifactEntry({ unsharedAt: '2026-05-25T00:02:00.000Z' }, 'unshared'),
    });

    expect(result).toMatchObject({
      status: 200,
      body: {
        artifact: {
          artifactId: 'artifact-1',
          slug: 'AbCd123_',
          title: 'Artifact report',
          unsharedAt: '2026-05-25T00:02:00.000Z',
        },
        unshared: true,
      },
    });
  });

  it('maps invalid, missing, and already-unshared unshare requests to route statuses', async () => {
    await expect(postArtifactUnsharePayload('bad')).resolves.toMatchObject({ status: 400 });
    await expect(postArtifactUnsharePayload('AbCd123_', { getBySlug: async () => null })).resolves.toMatchObject({ status: 404 });
    await expect(postArtifactUnsharePayload('AbCd123_', { getBySlug: async () => artifactEntry({}, 'unshared') })).resolves.toMatchObject({ status: 410 });
  });
});
