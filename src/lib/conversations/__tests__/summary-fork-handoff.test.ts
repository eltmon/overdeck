import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdir, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import type { Conversation } from '../../database/conversations-db.js';
import { createConversation, getConversationByName } from '../../database/conversations-db.js';
import { resetDatabase } from '../../database/index.js';
import { sessionFilePath } from '../../paths.js';
import { createHandoffPaths } from '../handoff-paths.js';
import {
  HandoffStallError,
  createSummaryFork,
  requestHandoffFromAgent,
  validateHandoffDoc,
} from '../summary-fork.js';
import { deliverAgentMessage } from '../../agents.js';

vi.mock('../../agents.js', () => ({
  deliverAgentMessage: vi.fn().mockResolvedValue(undefined),
}));

const originalPanopticonHome = process.env.PANOPTICON_HOME;
const originalHome = process.env.HOME;
const fixedNow = new Date('2026-05-23T04:35:00.000Z');

function sourceConversation(): Conversation {
  return {
    id: 1,
    name: 'conv-source',
    tmuxSession: 'conv-source-session',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd: '/tmp/project',
    issueId: null,
    claudeSessionId: 'session-123',
    model: null,
    effort: null,
    title: null,
    titleSource: null,
    titleSeed: null,
    archived: false,
    archivedAt: null,
    archivedReason: null,
    lastActivityAt: null,
    runtimeStatus: null,
    harness: 'claude-code',
    deliveryMethod: null,
    handoffDocPath: null,
    handoffTargetConvId: null,
    forkFallbackReason: null,
  };
}

function validDoc(): string {
  return [
    '## Current objective',
    'Continue implementing the handoff fork workflow for PAN-1358 with the live source conversation authoring the transfer document.',
    '## What has been done',
    'The prompt and handoff path helpers are already in place, and this document exists to satisfy the request handshake.',
    '## Suggested skills',
    '- /pan-workflow: use when checking Panopticon bead sequencing and completion flow.',
  ].join('\n\n');
}

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(deliverAgentMessage).mockReset();
  vi.mocked(deliverAgentMessage).mockResolvedValue(undefined);
  resetDatabase();
  if (originalPanopticonHome === undefined) {
    delete process.env.PANOPTICON_HOME;
  } else {
    process.env.PANOPTICON_HOME = originalPanopticonHome;
  }
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
});

describe('handoff fork handshake', () => {
  it('validates the required handoff document shape', () => {
    expect(validateHandoffDoc(validDoc())).toEqual({ ok: true });
    expect(validateHandoffDoc('## Suggested skills\nshort')).toEqual({
      ok: false,
      reason: 'handoff document must be at least 200 characters',
    });
    expect(validateHandoffDoc(validDoc().replace('## Suggested skills', '### Suggested skills'))).toEqual({
      ok: false,
      reason: 'handoff document must contain a ## Suggested skills section',
    });
  });

  it('delivers the rendered handoff prompt and returns the validated document', async () => {
    const home = join(tmpdir(), `pan-handoff-request-${Date.now()}`);
    process.env.PANOPTICON_HOME = home;
    const paths = createHandoffPaths('conv-source', fixedNow.toISOString());
    const docText = validDoc();

    vi.mocked(deliverAgentMessage).mockImplementation(async (_agentId, message) => {
      expect(message).toContain('Focus on dashboard follow-up work.');
      expect(message).toContain(paths.docPath);
      await mkdir(join(home, 'handoffs'), { recursive: true });
      await writeFile(paths.docPath, docText, 'utf-8');
      await writeFile(paths.sentinelPath, '', 'utf-8');
    });

    const result = await requestHandoffFromAgent(sourceConversation(), 'Focus on dashboard follow-up work.', {
      now: fixedNow,
    });

    expect(deliverAgentMessage).toHaveBeenCalledWith(
      'conv-source-session',
      expect.stringContaining('Agent-authored handoff request'),
      'handoff-request',
    );
    expect(result).toEqual({ docPath: paths.docPath, docText });
    rmSync(home, { recursive: true, force: true });
  });

  it('uses the handoff document as the fork seed and records source/target metadata', async () => {
    const home = join(tmpdir(), `pan-handoff-fork-${Date.now()}`);
    process.env.PANOPTICON_HOME = home;
    process.env.HOME = home;
    resetDatabase();

    const cwd = '/home/test/project';
    const sessionId = 'source-session-123';
    const sourceFile = sessionFilePath(cwd, sessionId);
    await mkdir(dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Continue this work' } })}\n`, 'utf-8');

    const source = createConversation({
      name: 'conv-source',
      tmuxSession: 'conv-source-session',
      cwd,
      issueId: 'PAN-1358',
      claudeSessionId: sessionId,
      title: 'Source title',
      titleSource: 'manual',
    });
    const docText = validDoc();

    vi.mocked(deliverAgentMessage).mockImplementation(async (_agentId, message) => {
      const outputPath = message.match(/`([^`]+\/handoffs\/[^`]+\.md)`/)?.[1];
      if (!outputPath) throw new Error('missing output path');
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, docText, 'utf-8');
      await writeFile(`${outputPath}.done`, '', 'utf-8');
    });

    const result = await Effect.runPromise(createSummaryFork(source, { forkMode: 'handoff' }));

    expect(result.summary).toBe(docText);
    expect(result.summaryModel).toBeNull();
    expect(result.forkMode).toBe('handoff');
    expect(result.handoffDocPath).toBeTruthy();
    expect(result.conversation.title).toBe('Handoff: Source title');
    expect(result.conversation.issueId).toBe('PAN-1358');
    expect(result.conversation.cwd).toBe(cwd);

    const targetRow = getConversationByName(result.conversation.name);
    const sourceRow = getConversationByName(source.name);
    expect(targetRow?.handoffDocPath).toBe(result.handoffDocPath);
    expect(sourceRow?.handoffTargetConvId).toBe(result.conversation.id);
    rmSync(home, { recursive: true, force: true });
  });

  it('times out distinctly when the document and sentinel do not both appear', async () => {
    vi.useFakeTimers();
    const home = join(tmpdir(), `pan-handoff-timeout-${Date.now()}`);
    process.env.PANOPTICON_HOME = home;

    const result = requestHandoffFromAgent(sourceConversation(), undefined, {
      now: fixedNow,
      timeoutMs: 0,
      pollIntervalMs: 1_000,
    });

    await expect(result).rejects.toBeInstanceOf(HandoffStallError);
    rmSync(home, { recursive: true, force: true });
  });
});
