import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { Command } from 'commander';

const mocks = vi.hoisted(() => ({
  createArtifact: vi.fn(),
  getArtifactStatus: vi.fn(),
  publishArtifact: vi.fn(),
  resolveArtifactUrl: vi.fn(),
  unshareArtifact: vi.fn(),
}));

vi.mock('../../../lib/artifacts/lifecycle.js', () => mocks);

import {
  artifactCreateCommand,
  artifactPublishCommand,
  artifactShareCommand,
  artifactUnshareCommand,
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

  it('registers create, publish, unshare, and share subcommands', () => {
    const program = new Command();
    registerArtifactCommands(program);

    const artifacts = program.commands.find(command => command.name() === 'artifacts');

    expect(artifacts?.commands.map(command => command.name())).toEqual(['create', 'publish', 'unshare', 'share']);
    expect(artifacts?.commands.find(command => command.name() === 'create')?.helpInformation()).toContain('--agent-role <role>');
    expect(artifacts?.commands.find(command => command.name() === 'share')?.helpInformation()).toContain('--tunnel');
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
