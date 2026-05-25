import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactIndexRepository, getArtifactSnapshotPath } from '../../src/lib/artifacts/index-store.js';
import {
  ArtifactValidationError,
  createArtifact,
  getArtifactStatus,
  listArtifacts,
  publishArtifact,
  resolveArtifactUrl,
  unshareArtifact,
} from '../../src/lib/artifacts/lifecycle.js';

describe('artifact lifecycle', () => {
  let originalHome: string | undefined;
  let originalIssue: string | undefined;
  let originalWorkspace: string | undefined;
  let originalRole: string | undefined;
  let originalHarness: string | undefined;
  let originalRun: string | undefined;
  let originalSession: string | undefined;
  let home: string;
  let repo: ArtifactIndexRepository;
  let tick: number;

  beforeEach(() => {
    originalHome = process.env.PANOPTICON_HOME;
    originalIssue = process.env.PAN_ISSUE_ID;
    originalWorkspace = process.env.PAN_WORKSPACE_ID;
    originalRole = process.env.PAN_AGENT_ROLE;
    originalHarness = process.env.PAN_AGENT_HARNESS;
    originalRun = process.env.PAN_RUN_ID;
    originalSession = process.env.PAN_SESSION_ID;

    home = mkdtempSync(join(tmpdir(), 'pan-artifact-lifecycle-'));
    process.env.PANOPTICON_HOME = home;
    process.env.PAN_ISSUE_ID = 'PAN-1205';
    process.env.PAN_WORKSPACE_ID = 'feature-pan-1205-slot-2';
    process.env.PAN_AGENT_ROLE = 'work';
    process.env.PAN_AGENT_HARNESS = 'claude-code';
    process.env.PAN_RUN_ID = 'RUN-42';
    process.env.PAN_SESSION_ID = 'session-123';

    tick = 0;
    repo = new ArtifactIndexRepository({
      slugGenerator: () => 'slug0001',
      now: () => `2026-05-25T00:0${tick++}:00.000Z`,
    });
  });

  afterEach(() => {
    repo.close();
    restoreEnv('PANOPTICON_HOME', originalHome);
    restoreEnv('PAN_ISSUE_ID', originalIssue);
    restoreEnv('PAN_WORKSPACE_ID', originalWorkspace);
    restoreEnv('PAN_AGENT_ROLE', originalRole);
    restoreEnv('PAN_AGENT_HARNESS', originalHarness);
    restoreEnv('PAN_RUN_ID', originalRun);
    restoreEnv('PAN_SESSION_ID', originalSession);
    rmSync(home, { recursive: true, force: true });
  });

  it('creates a validated published artifact with provenance, snapshot bytes, and stable URLs', async () => {
    const filePath = join(home, 'comparison.html');
    writeFileSync(filePath, html('<title>R&amp;D Comparison</title>', '<h1>Options</h1>'));

    const result = await createArtifact(filePath, {
      repository: repo,
      baseDomain: 'example.test',
      now: () => '2026-05-25T00:00:00.000Z',
    });

    expect(result.published).toBe(true);
    expect(result.validation.ok).toBe(true);
    expect(result.artifact).toMatchObject({
      slug: 'slug0001',
      issueId: 'PAN-1205',
      workspaceId: 'feature-pan-1205-slot-2',
      agentRole: 'work',
      agentHarness: 'claude-code',
      runId: 'RUN-42',
      sessionId: 'session-123',
      title: 'R&D Comparison',
      filePath,
      lastPublishedHash: result.validation.hash,
      currentHash: result.validation.hash,
      publishedAt: '2026-05-25T00:00:00.000Z',
    });
    expect(result.urls).toEqual({
      wrapperUrl: 'https://example.test/s/slug0001',
      rawUrl: 'https://artifacts.example.test/a/slug0001',
    });
    expect(readFileSync(getArtifactSnapshotPath('slug0001'), 'utf-8')).toBe(readFileSync(filePath, 'utf-8'));
  });

  it('reports pending changes after edits and clears them after publish while preserving slug', async () => {
    const filePath = join(home, 'comparison.html');
    writeFileSync(filePath, html('<title>Comparison</title>', '<p>first</p>'));
    const created = await createArtifact(filePath, { repository: repo, baseDomain: 'example.test' });

    writeFileSync(filePath, html('<title>Comparison</title>', '<p>second</p>'));
    const pending = await getArtifactStatus(filePath, { repository: repo, validate: false });

    expect(pending.artifact?.slug).toBe(created.artifact.slug);
    expect(pending.currentHash).not.toBe(created.artifact.lastPublishedHash);
    expect(pending.lastPublishedHash).toBe(created.artifact.lastPublishedHash);
    expect(pending.pendingChanges).toBe(true);

    const published = await publishArtifact(filePath, { repository: repo, baseDomain: 'example.test' });

    expect(published.artifact.slug).toBe(created.artifact.slug);
    expect(published.artifact.lastPublishedHash).toBe(pending.currentHash);
    expect(published.pendingChanges).toBe(false);
    expect(readFileSync(getArtifactSnapshotPath('slug0001'), 'utf-8')).toContain('second');
  });

  it('lists artifacts by issue or workspace and resolves URLs', async () => {
    const filePath = join(home, 'comparison.html');
    writeFileSync(filePath, html('<title>Comparison</title>', '<p>body</p>'));
    await createArtifact(filePath, { repository: repo, baseDomain: 'example.test' });

    expect(listArtifacts({ repository: repo, issueId: 'PAN-1205', baseDomain: 'example.test' }).artifacts).toHaveLength(1);
    expect(listArtifacts({ repository: repo, workspaceId: 'feature-pan-1205-slot-2', baseDomain: 'example.test' }).artifacts[0]).toMatchObject({
      urls: {
        wrapperUrl: 'https://example.test/s/slug0001',
        rawUrl: 'https://artifacts.example.test/a/slug0001',
      },
      status: 'published',
      pendingChanges: false,
    });
    expect(resolveArtifactUrl('slug0001', { baseDomain: 'example.test' })).toEqual({
      wrapperUrl: 'https://example.test/s/slug0001',
      rawUrl: 'https://artifacts.example.test/a/slug0001',
    });
  });

  it('unshares without deleting source, snapshot, or metadata', async () => {
    const filePath = join(home, 'comparison.html');
    writeFileSync(filePath, html('<title>Comparison</title>', '<p>body</p>'));
    await createArtifact(filePath, { repository: repo });

    const result = unshareArtifact(filePath, { repository: repo, now: () => '2026-05-25T00:10:00.000Z' });

    expect(result.unshared).toBe(true);
    expect(result.artifact.unsharedAt).toBe('2026-05-25T00:10:00.000Z');
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(getArtifactSnapshotPath('slug0001'))).toBe(true);
    expect(repo.getByFilePath(filePath)?.status).toBe('unshared');
  });

  it('rejects invalid artifacts before creating metadata or snapshots', async () => {
    const filePath = join(home, 'secret.html');
    writeFileSync(filePath, html('<title>Secret</title>', `<pre>ghp_${'A'.repeat(36)}</pre>`));

    await expect(createArtifact(filePath, { repository: repo })).rejects.toBeInstanceOf(ArtifactValidationError);
    expect(repo.getByFilePath(filePath)).toBeNull();
    expect(existsSync(join(home, 'artifacts', 'snapshots'))).toBe(false);
  });
});

function html(head: string, body: string): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
