import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __testInternals } from '../../../src/lib/memory/checkpoint-client.js';
import type { ClaimTranscriptRangeResult, TranscriptCheckpoint } from '../../../src/lib/memory/checkpoints.js';

describe('checkpoint worker URL', () => {
  const { checkpointWorkerUrl } = __testInternals;

  it('resolves an arbitrary CLI chunk from the dist root', () => {
    expect(checkpointWorkerUrl('file:///opt/overdeck/dist/cli/index.js').href)
      .toBe('file:///opt/overdeck/dist/lib/memory/checkpoint-worker.js');
    expect(checkpointWorkerUrl('file:///opt/overdeck/dist/pipeline-B_onMFsl.js').href)
      .toBe('file:///opt/overdeck/dist/lib/memory/checkpoint-worker.js');
  });

  it('resolves an arbitrary dashboard chunk from the dashboard dist directory', () => {
    expect(checkpointWorkerUrl('file:///opt/overdeck/dist/dashboard/server.js').href)
      .toBe('file:///opt/overdeck/dist/dashboard/checkpoint-worker.js');
    expect(checkpointWorkerUrl('file:///opt/overdeck/dist/dashboard/pipeline-B_onMFsl.js').href)
      .toBe('file:///opt/overdeck/dist/dashboard/checkpoint-worker.js');
  });

  it('preserves source-mode and unbundled JavaScript resolution', () => {
    expect(checkpointWorkerUrl('file:///opt/overdeck/src/lib/memory/checkpoint-client.ts').href)
      .toBe('file:///opt/overdeck/src/lib/memory/checkpoint-worker.ts');
    expect(checkpointWorkerUrl('file:///opt/overdeck/src/lib/memory/checkpoint-client.js').href)
      .toBe('file:///opt/overdeck/src/lib/memory/checkpoint-worker.js');
  });
});

// PAN-3930: under Vitest the public API runs checkpoints inline, so this goes
// through the worker path directly. From source the worker is a `.ts` file whose
// imports use `.js` specifiers; spawned as a raw Node worker it died with
// ERR_MODULE_NOT_FOUND on its first relative import.
describe('checkpoint worker under a source run', () => {
  const { requestViaWorker, terminateWorker } = __testInternals;
  let tempDir: string | null = null;
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.OVERDECK_HOME;
    tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-checkpoint-client-'));
    process.env.OVERDECK_HOME = tempDir;
  });

  afterEach(async () => {
    await terminateWorker();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it('claims and reads a checkpoint through the real worker thread', async () => {
    const claim = await requestViaWorker<ClaimTranscriptRangeResult>('claimTranscriptRange', {
      sessionId: 'session-worker',
      expectedFromOffset: 0,
      toOffset: 100,
      transcriptPath: '/tmp/session-worker.jsonl',
      identity: { projectId: 'overdeck', workspaceId: 'feature-pan-3930', issueId: 'PAN-3930' },
    });
    expect(claim.status).toBe('claimed');

    const checkpoint = await requestViaWorker<TranscriptCheckpoint | null>('getTranscriptCheckpoint', 'session-worker');
    expect(checkpoint).toMatchObject({ sessionId: 'session-worker', claimFrom: 0, claimTo: 100 });
  }, 30_000);
});
