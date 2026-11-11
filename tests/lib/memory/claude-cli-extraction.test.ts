import { appendFile, readFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryIdentity, MemoryObservation } from '@overdeck/contracts';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';
import { closeMemoryFtsDatabases } from '../../../src/lib/memory/fts-db.js';
import { extractFromTranscriptDelta } from '../../../src/lib/memory/pipeline.js';
import { createWorkspace, upsertProjectFromConfig } from '../../../src/lib/workspaces/writer.js';
import { registerExtractionProvider } from '../../../src/lib/memory/providers/index.js';
import { ClaudeCliExtractionProvider } from '../../../src/lib/memory/providers/claude-cli.js';
import { AnthropicExtractionProvider } from '../../../src/lib/memory/providers/anthropic.js';
import type { RunClaudeStructuredInput } from '../../../src/lib/background-ai/claude-structured.js';

let identity: MemoryIdentity;

let tempDir: string | null = null;
let originalHome: string | undefined;
let originalMemoryProviderEnv: string | undefined;
let originalMemoryModelEnv: string | undefined;
let odb: OverdeckTestDb;

beforeEach(async () => {
  originalHome = process.env.OVERDECK_HOME;
  originalMemoryProviderEnv = process.env.OVERDECK_MEMORY_PROVIDER;
  originalMemoryModelEnv = process.env.OVERDECK_MEMORY_MODEL;
  delete process.env.OVERDECK_MEMORY_PROVIDER;
  delete process.env.OVERDECK_MEMORY_MODEL;

  odb = setupOverdeckTestDb();
  tempDir = odb.home;

  upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: join(odb.home, 'overdeck') });
  const workspaceId = await createWorkspace({
    projectId: 'overdeck',
    kind: 'issue',
    name: 'feature-pan-4374',
    path: join(odb.home, 'workspaces', 'feature-pan-4374'),
    issueId: 'PAN-4374',
  });
  identity = {
    projectId: 'overdeck',
    workspaceId,
    issueId: 'PAN-4374',
    runId: 'run-1',
    sessionId: 'session-1',
    agentRole: 'work',
    agentHarness: 'claude-code',
  };
}, 20_000);

afterEach(async () => {
  closeMemoryFtsDatabases();
  teardownOverdeckTestDb(odb);
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (originalMemoryProviderEnv === undefined) delete process.env.OVERDECK_MEMORY_PROVIDER;
  else process.env.OVERDECK_MEMORY_PROVIDER = originalMemoryProviderEnv;
  if (originalMemoryModelEnv === undefined) delete process.env.OVERDECK_MEMORY_MODEL;
  else process.env.OVERDECK_MEMORY_MODEL = originalMemoryModelEnv;
  tempDir = null;
  registerExtractionProvider(new AnthropicExtractionProvider());
});

describe('PAN-4374 claude-cli provider end-to-end extraction', () => {
  it('writes an observation to disk through extractFromTranscriptDelta with no extract override', { timeout: 20_000 }, async () => {
    const stubRun = vi.fn(async (_input: RunClaudeStructuredInput) => ({
      is_error: false,
      structured_output: {
        narrative: 'Durable narrative for the claude-cli provider.',
        summary: 'claude-cli extraction wrote this observation.',
        actionStatus: 'Completed via claude-cli',
        tags: ['handoff'],
        files: ['src/lib/memory/providers/claude-cli.ts'],
      },
      usage: { input_tokens: 12, output_tokens: 6, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }));
    registerExtractionProvider(new ClaudeCliExtractionProvider(stubRun));

    const transcriptPath = join(tempDir!, 'session-1.jsonl');
    await appendFile(transcriptPath, `${JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'memory extraction via claude-cli' }] },
    })}\n`, 'utf8');

    const result = await extractFromTranscriptDelta({
      sessionId: identity.sessionId,
      transcriptPath,
      fromOffset: 0,
      toOffset: (await readFile(transcriptPath, 'utf8')).length,
      identity,
      trigger: 'stop-hook',
      gitBranch: 'feature/pan-4374',
      now: new Date('2026-11-11T23:01:00.000Z'),
      id: 'obs-claude-cli-1',
      settings: { provider: 'claude-cli', model: 'claude-haiku-5-5' },
      emitObservationCreated: async () => undefined,
      rollupOptions: { loadThreshold: () => 100 },
    });

    expect(result.status).toBe('written');

    const observationsPath = join(tempDir!, 'memory/overdeck', identity.workspaceId, 'observations/2026-11-11.jsonl');
    const raw = await readFile(observationsPath, 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(1);
    const observation = JSON.parse(lines[0]!) as MemoryObservation;
    expect(observation.summary).toBe('claude-cli extraction wrote this observation.');

    expect(stubRun).toHaveBeenCalledTimes(1);
    expect(stubRun.mock.calls[0][0].model).toBe('claude-haiku-5-5');
  });
});
