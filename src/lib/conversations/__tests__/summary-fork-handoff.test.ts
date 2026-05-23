import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { Conversation } from '../../database/conversations-db.js';
import { createHandoffPaths } from '../handoff-paths.js';
import {
  HandoffStallError,
  requestHandoffFromAgent,
  validateHandoffDoc,
} from '../summary-fork.js';
import { deliverAgentMessage } from '../../agents.js';

vi.mock('../../agents.js', () => ({
  deliverAgentMessage: vi.fn().mockResolvedValue(undefined),
}));

const originalPanopticonHome = process.env.PANOPTICON_HOME;
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
  if (originalPanopticonHome === undefined) {
    delete process.env.PANOPTICON_HOME;
  } else {
    process.env.PANOPTICON_HOME = originalPanopticonHome;
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
