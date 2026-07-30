/**
 * PAN-1990 memory-capture-nonissue: observation capture + prompt-time
 * injection for conversations in a main/scratch workspace (no work agent,
 * no issue). Covers all four acceptance criteria.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryIdentity } from '@overdeck/contracts';

import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../../tests/helpers/overdeck-test-db.js';
import { createWorkspace, pinDoc, upsertProjectFromConfig } from '../../workspaces/writer.js';
import { createConversation } from '../../overdeck/conversations.js';
import { sessionFilePath } from '../../paths.js';
import { handleMemorySessionStartBody, type HandleMemorySessionStartBodyResult } from '../../../dashboard/server/routes/hooks.js';
import { injectPromptTimeMemory } from '../injection.js';
import { TranscriptPoller } from '../poller.js';
import type { TranscriptEntry } from '../transcript-source.js';

vi.mock('../settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../settings.js')>();
  return { ...actual, areMemoryObservationsEnabled: async () => true };
});

let odb: OverdeckTestDb;
let projectRoot: string;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  projectRoot = mkdtempSync(join(tmpdir(), 'pan-1990-workspace-capture-'));
  upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: projectRoot });
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('observation capture for a conversation in a scratch workspace (ac1)', () => {
  it('resolves a null-issueId identity with the correct workspace UUID and registers the transcript for polling', async () => {
    const workspaceId = await createWorkspace({
      projectId: 'overdeck', kind: 'scratch', name: 'scratch-notes', path: join(projectRoot, 'scratch-notes'),
    });
    const sessionId = 'session-scratch-1';
    createConversation({
      name: 'conv-scratch-1',
      tmuxSession: 'conv-scratch-1',
      cwd: join(projectRoot, 'scratch-notes'),
      claudeSessionId: sessionId,
      workspaceId,
    });

    const registerTranscript = vi.fn();
    const transcriptPath = sessionFilePath(join(projectRoot, 'scratch-notes'), sessionId);

    const result: HandleMemorySessionStartBodyResult = await handleMemorySessionStartBody({
      session_id: sessionId,
      transcript_path: transcriptPath,
    }, {
      statTranscript: async () => ({ size: 0, mtimeMs: 0 }),
      registerTranscript,
      recordBriefingSessionStart: async () => undefined,
    });

    expect(result.status).toBe('accepted');
    expect(registerTranscript).toHaveBeenCalledTimes(1);
    const entry = registerTranscript.mock.calls[0]![0] as TranscriptEntry;
    expect(entry.identity).toMatchObject({
      projectId: 'overdeck',
      workspaceId,
      issueId: null,
      agentRole: 'conversation',
    });
  });
});

describe('prompt-time injection for a null-issueId workspace turn (ac2, ac3)', () => {
  const identity: MemoryIdentity = {
    projectId: 'overdeck',
    workspaceId: 'workspace-scratch-1',
    issueId: null,
    runId: 'conv-scratch-1',
    sessionId: 'session-scratch-1',
    agentRole: 'conversation',
    agentHarness: 'claude-code',
  };

  // PAN-3286 FR-11 replaced the old "null issue ⇒ empty sibling slot" rule with a
  // same-project cross-workspace search, so this case now asserts the workspace's
  // OWN status/observations plus the shape of that cross-workspace call. The
  // cross-workspace hits themselves are covered in tests/lib/memory/injection.test.ts.
  it('returns status and observations for the workspace and queries other workspaces for the sibling slot', async () => {
    const status = {
      name: 'Scratch workspace status',
      headline: 'Exploring the memory capture design.',
      summary: 'Non-issue workspace turns are captured.',
      goal: null,
      phase: 'building' as const,
      accomplished: [],
      decided: [],
      open: [],
      nextSteps: [],
      confidence: 0.8,
      workingSet: [],
      tags: [],
    };
    const search = vi.fn(async (params: { sibling?: boolean; crossWorkspace?: boolean }) => {
      // The sibling slot is the cross-workspace arm for a null-issue turn; this
      // case seeds it empty to stay focused on the workspace's own context.
      if (params.sibling || params.crossWorkspace) return [];
      return [{
        rowid: 1,
        content: 'workspace scoped observation content',
        displayContent: 'workspace scoped observation content',
        source: 'obs-1',
        branch: 'main',
        entryDate: '2026-07-28',
        entryTime: '10:00:00.000Z',
        entryType: 'memory',
        files: [],
        tags: [],
        docType: 'observation',
        scope: 'workspace',
        projectId: 'overdeck',
        workspaceId: 'workspace-scratch-1',
        issueId: '',
        runId: 'conv-scratch-1',
        sessionId: 'session-scratch-1',
        agentRole: 'conversation',
        agentHarness: 'claude-code',
        bm25: -1,
        rankScore: 1,
        provenance: 'workspace scoped observation content',
        tokenBudget: null,
      }];
    });

    const result = await injectPromptTimeMemory({
      prompt: 'what have we done so far',
      identity,
      loadStatus: async () => status,
      loadKnowledgeIndexEnabled: async () => false,
      search: search as never,
      expansion: async () => ({ query: 'done far', expandedTerms: [], cacheKey: 'k', status: 'extracted' }),
      logDecision: async () => undefined,
    });

    expect(result.status).toBe('injected');
    expect(result.context).toContain('Exploring the memory capture design.');
    expect(result.context).toContain('workspace scoped observation content');
    expect(result.context).not.toContain('Sibling memory hint');
    expect(result.decision.hitCounts.sibling).toBe(0);
    // The sibling slot asked other workspaces in this project, excluding this one.
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'overdeck',
      crossWorkspace: true,
      excludeWorkspaceId: 'workspace-scratch-1',
    }));
  });

  it('includes the pinned project doc under the knowledge budget', async () => {
    const docPath = 'docs/ARCHITECTURE.md';
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(join(projectRoot, docPath), 'Pinned architecture notes for the project.', 'utf-8');
    await pinDoc('project', 'overdeck', docPath);

    const result = await injectPromptTimeMemory({
      prompt: 'architecture question',
      identity,
      loadStatus: async () => null,
      loadKnowledgeIndexEnabled: async () => true,
      loadKnowledgeIndex: async () => null,
      search: async () => [],
      expansion: async () => ({ query: 'architecture', expandedTerms: [], cacheKey: 'k', status: 'extracted' }),
      logDecision: async () => undefined,
    });

    expect(result.status).toBe('injected');
    expect(result.context).toContain('Pinned architecture notes for the project.');
    expect(result.decision.sources.some((source: { id: string }) => source.id.startsWith('pin:'))).toBe(true);
  });
});

describe('poller extraction for a null-issueId workspace turn, fake-timer safe (ac4)', () => {
  const identity: MemoryIdentity = {
    projectId: 'overdeck',
    workspaceId: 'workspace-scratch-1',
    issueId: null,
    runId: 'conv-scratch-1',
    sessionId: 'session-scratch-1',
    agentRole: 'conversation',
    agentHarness: 'claude-code',
  };

  it('produces an observation for a registered null-issueId transcript without any real timer waits', async () => {
    const statTranscript = vi.fn()
      .mockResolvedValueOnce({ size: 10, mtimeMs: 1 })
      .mockResolvedValueOnce({ size: 20, mtimeMs: 2 });
    const readTranscriptSlice = vi.fn()
      .mockResolvedValueOnce('{"type":"user"}\n')
      .mockResolvedValueOnce('{"type":"assistant"}\n');
    const enqueue = vi.fn(async () => ({ status: 'written' as const, observation: {} as never, reason: null } as never));
    const poller = new TranscriptPoller({
      activityLineThreshold: 2,
      statTranscript,
      readTranscriptSlice,
      getTranscriptCheckpoint: () => null,
      enqueueTranscriptDelta: enqueue,
    });
    poller.register({
      agentId: 'conv-scratch-1',
      sessionId: 'session-scratch-1',
      transcriptPath: '/tmp/session-scratch-1.jsonl',
      identity,
      harness: 'claude-code',
      size: 0,
      mtimeMs: 0,
    });

    await expect(poller.tick()).resolves.toMatchObject({ belowThreshold: 1, fired: 0 });
    await expect(poller.tick()).resolves.toMatchObject({ belowThreshold: 0, fired: 1 });

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-scratch-1',
      trigger: 'poller',
      identity: expect.objectContaining({ issueId: null, workspaceId: 'workspace-scratch-1' }),
    }));
  });
});
