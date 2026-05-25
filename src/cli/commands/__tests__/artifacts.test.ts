import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactIndexRepository } from '../../../lib/artifacts/index-store.js';

const mocks = vi.hoisted(() => ({
  createArtifact: vi.fn(),
  getArtifactStatus: vi.fn(),
  listArtifacts: vi.fn(),
  publishArtifact: vi.fn(),
  resolveArtifactUrl: vi.fn(),
  unshareArtifact: vi.fn(),
}));

vi.mock('../../../lib/artifacts/lifecycle.js', () => mocks);

import {
  artifactCreateCommand,
  artifactListCommand,
  artifactOpenCommand,
  artifactPublishCommand,
  artifactShareCommand,
  artifactStatusCommand,
  artifactUnshareCommand,
  artifactUrlCommand,
  artifactValidateCommand,
  registerArtifactCommands,
} from '../artifacts.js';

const artifact = {
  artifactId: 'artifact-1',
  slug: 'slug0001',
  issueId: 'PAN-1205',
  workspaceId: 'feature-pan-1205-slot-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
  runId: 'run-1',
  sessionId: 'session-1',
  filePath: '/tmp/report.html',
  currentHash: 'sha256:current',
  lastPublishedHash: 'sha256:current',
  supersedes: null,
  title: 'Report',
  description: null,
  createdAt: '2026-05-25T00:00:00.000Z',
  publishedAt: '2026-05-25T00:00:00.000Z',
  unsharedAt: null,
};

const urls = {
  wrapperUrl: 'https://pan.localhost/s/slug0001',
  rawUrl: 'https://artifacts.pan.localhost/a/slug0001',
};

describe('artifact CLI commands', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdinDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    mocks.resolveArtifactUrl.mockReturnValue(urls);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (stdinDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
    process.exitCode = undefined;
  });

  it('creates and publishes an artifact with explicit provenance flags', async () => {
    mocks.createArtifact.mockResolvedValue({ artifact, urls, validation: validation(true), published: true });

    await artifactCreateCommand('/tmp/report.html', {
      issue: 'PAN-1205',
      workspace: 'feature-pan-1205-slot-1',
      agentRole: 'work',
      agentHarness: 'claude-code',
      runId: 'run-1',
      sessionId: 'session-1',
      title: 'Report',
      description: 'Artifact report',
      strict: true,
      json: true,
    });

    expect(mocks.createArtifact).toHaveBeenCalledWith(resolve('/tmp/report.html'), {
      issueId: 'PAN-1205',
      workspaceId: 'feature-pan-1205-slot-1',
      agentRole: 'work',
      agentHarness: 'claude-code',
      runId: 'run-1',
      sessionId: 'session-1',
      title: 'Report',
      description: 'Artifact report',
      validation: { strict: true },
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"published": true'));
  });

  it('reports publish as a no-op when no changes are pending', async () => {
    mocks.getArtifactStatus.mockResolvedValue({
      artifact,
      filePath: artifact.filePath,
      currentHash: artifact.currentHash,
      lastPublishedHash: artifact.lastPublishedHash,
      pendingChanges: false,
      validation: validation(true),
    });

    await artifactPublishCommand('/tmp/report.html', {});

    expect(mocks.publishArtifact).not.toHaveBeenCalled();
    expect(mocks.resolveArtifactUrl).toHaveBeenCalledWith('slug0001');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No pending changes'));
  });

  it('revalidates and republishes when changes are pending', async () => {
    mocks.getArtifactStatus.mockResolvedValue({
      artifact: { ...artifact, currentHash: 'sha256:edited' },
      filePath: artifact.filePath,
      currentHash: 'sha256:edited',
      lastPublishedHash: artifact.lastPublishedHash,
      pendingChanges: true,
      validation: validation(true),
    });
    mocks.publishArtifact.mockResolvedValue({ artifact: { ...artifact, currentHash: 'sha256:edited' }, urls, validation: validation(true), published: true, pendingChanges: false });

    await artifactPublishCommand('/tmp/report.html', { strict: true, json: true });

    expect(mocks.getArtifactStatus).toHaveBeenCalledWith(resolve('/tmp/report.html'), { validation: { strict: true } });
    expect(mocks.publishArtifact).toHaveBeenCalledWith(resolve('/tmp/report.html'), { validation: { strict: true } });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"pendingChanges": false'));
  });

  it('requires --yes for JSON or non-interactive unshare', async () => {
    await expect(artifactUnshareCommand('/tmp/report.html', { json: true })).rejects.toThrow('Refusing to unshare without --yes');

    expect(mocks.unshareArtifact).not.toHaveBeenCalled();
  });

  it('unshares with --yes without deleting artifact metadata', async () => {
    mocks.unshareArtifact.mockReturnValue({ artifact: { ...artifact, unsharedAt: '2026-05-25T00:10:00.000Z' }, unshared: true });

    await artifactUnshareCommand('/tmp/report.html', { yes: true, json: true });

    expect(mocks.unshareArtifact).toHaveBeenCalledWith(resolve('/tmp/report.html'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"unshared": true'));
  });

  it('exits with a clear tunnel stub without exposing anything externally', async () => {
    await expect(artifactShareCommand('/tmp/report.html', { tunnel: true })).rejects.toThrow('process.exit:1');

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('tunneling not yet supported'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('validates artifacts as JSON and exits non-zero on hard failures', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pan-artifact-cli-'));
    try {
      const filePath = join(home, 'bad.html');
      writeFileSync(filePath, `<!doctype html><html><body>ghp_${'A'.repeat(36)}</body></html>`);

      await artifactValidateCommand(filePath, { json: true }, { cwd: home });

      const output = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
      expect(output.ok).toBe(false);
      expect(output.errors[0].code).toBe('secret_detected');
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('prints status for known artifacts with hash and pending fields', async () => {
    const { home, repo, filePath } = createIndexedArtifact();
    try {
      mocks.getArtifactStatus.mockResolvedValue({
        artifact,
        filePath,
        currentHash: artifact.currentHash,
        lastPublishedHash: artifact.lastPublishedHash,
        pendingChanges: false,
      });

      await artifactStatusCommand(filePath, {}, { repository: repo, cwd: home });

      const output = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
      expect(output).toContain(`filePath: ${filePath}`);
      expect(output).toContain('slug: slug0001');
      expect(output).toContain('status: published');
      expect(output).toContain('currentHash: sha256:current');
      expect(output).toContain('lastPublishedHash: sha256:current');
      expect(output).toContain('pendingChanges: false');
    } finally {
      repo.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('reports a useful not-found error for unknown artifact status', async () => {
    const filePath = '/tmp/unknown.html';
    mocks.getArtifactStatus.mockResolvedValue({
      filePath,
      currentHash: 'sha256:unknown',
      lastPublishedHash: null,
      pendingChanges: true,
    });

    await artifactStatusCommand(filePath, { json: true });

    const output = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(output.error).toBe(`No artifact exists for ${filePath}`);
    expect(output.currentHash).toBe('sha256:unknown');
    expect(output.pendingChanges).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('lists artifacts with workspace filtering as JSON', () => {
    mocks.listArtifacts.mockReturnValue({
      artifacts: [{ artifact, urls, status: 'published', pendingChanges: false }],
    });

    artifactListCommand({ workspace: 'feature-pan-1205-slot-1', json: true });

    expect(mocks.listArtifacts).toHaveBeenCalledWith({ repository: expect.any(ArtifactIndexRepository), workspaceId: 'feature-pan-1205-slot-1' });
    const output = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(output.artifacts).toHaveLength(1);
    expect(output.artifacts[0]).toMatchObject({
      artifact: { slug: 'slug0001', workspaceId: 'feature-pan-1205-slot-1', issueId: 'PAN-1205' },
      status: 'published',
      pendingChanges: false,
    });
  });

  it('prints and opens wrapper URLs without blocking tests', async () => {
    const { home, repo, filePath } = createIndexedArtifact();
    const opener = vi.fn();
    try {
      const url = artifactUrlCommand(filePath, {}, { repository: repo, cwd: home });
      await artifactOpenCommand(filePath, { json: true }, { repository: repo, cwd: home, opener });

      expect(url).toBe('https://pan.localhost/s/slug0001');
      expect(console.log).toHaveBeenCalledWith('https://pan.localhost/s/slug0001');
      expect(opener).toHaveBeenCalledWith('https://pan.localhost/s/slug0001');
      const opened = JSON.parse(String(vi.mocked(console.log).mock.calls[1]?.[0]));
      expect(opened).toEqual({ opened: true, url: 'https://pan.localhost/s/slug0001' });
    } finally {
      repo.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('registers write and read artifact subcommands', () => {
    const program = new Command();
    registerArtifactCommands(program);

    const artifacts = program.commands.find(command => command.name() === 'artifacts');

    expect(artifacts?.commands.map(command => command.name())).toEqual([
      'create',
      'publish',
      'unshare',
      'share',
      'validate',
      'status',
      'list',
      'url',
      'open',
    ]);
    expect(artifacts?.commands.find(command => command.name() === 'create')?.helpInformation()).toContain('--agent-role <role>');
    expect(artifacts?.commands.find(command => command.name() === 'share')?.helpInformation()).toContain('--tunnel');
    expect(artifacts?.commands.find(command => command.name() === 'validate')?.helpInformation()).toContain('--strict');
    expect(artifacts?.commands.find(command => command.name() === 'list')?.helpInformation()).toContain('--workspace <id>');
  });
});

function validation(ok: boolean) {
  return {
    ok,
    filePath: artifact.filePath,
    size: 128,
    hash: artifact.currentHash,
    strict: false,
    errors: [],
    warnings: [],
  };
}

function createIndexedArtifact(): { home: string; repo: ArtifactIndexRepository; filePath: string } {
  const home = mkdtempSync(join(tmpdir(), 'pan-artifact-cli-'));
  const repo = new ArtifactIndexRepository({ dbPath: join(home, 'index.sqlite') });
  const filePath = join(home, 'report.html');
  writeFileSync(filePath, html('Report', '<p>published</p>'));
  repo.createArtifact({
    artifactId: artifact.artifactId,
    slug: artifact.slug,
    issueId: artifact.issueId,
    workspaceId: artifact.workspaceId,
    agentRole: 'work',
    agentHarness: 'claude-code',
    runId: artifact.runId,
    sessionId: artifact.sessionId,
    filePath,
    currentHash: artifact.currentHash,
    lastPublishedHash: artifact.lastPublishedHash,
    title: artifact.title,
    description: artifact.description,
    createdAt: artifact.createdAt,
    publishedAt: artifact.publishedAt,
  });
  return { home, repo, filePath };
}

function html(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
}
