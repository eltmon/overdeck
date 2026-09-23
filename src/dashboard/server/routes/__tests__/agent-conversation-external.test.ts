/**
 * PAN-3920 W21 / FR-18 — an external agent opens on the existing agent
 * transcript route: the registration's sessions.json path is the transcript,
 * the registration's cwd is the workspace, and no tmux lookup is made.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAgentWorkspace = vi.fn(() => Effect.succeed('/should/not/be/used'));
vi.mock('../../../../lib/agent-enrichment.js', () => ({
  getClaudeProjectDir: vi.fn(),
  getAgentWorkspace: (...args: unknown[]) => getAgentWorkspace(...(args as [])),
  getAgentJsonlPath: vi.fn(),
  getPendingQuestions: vi.fn(),
  getAgentPendingQuestions: vi.fn(),
}));

const parseCodexConversationMessages = vi.fn(async () => ({
  messages: [{ id: 'm1', role: 'assistant' }], workLog: [], streaming: true, totalCost: 1.5, byteOffset: 0,
}));
vi.mock('../../services/codex-conversation-parser.js', () => ({
  parseCodexConversationMessages: (...args: unknown[]) => parseCodexConversationMessages(...(args as [])),
}));

import { buildAgentConversationResult } from '../agents/conversation.js';
import { recordExternalTranscript, registerExternalAgent } from '../../../../lib/agents/external-registry.js';

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.OVERDECK_HOME;
  home = mkdtempSync(join(tmpdir(), 'agent-conversation-external-'));
  process.env.OVERDECK_HOME = home;
  getAgentWorkspace.mockClear();
  parseCodexConversationMessages.mockClear();
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe('buildAgentConversationResult for an external agent', () => {
  it('parses the registered rollout without a tmux workspace lookup', async () => {
    const rollout = join(home, 'rollout-2026-09-23T10-00-00-thread-1.jsonl');
    writeFileSync(rollout, '');
    const { id } = await registerExternalAgent({
      source: 'codex-plugin', externalId: 'task-1', harness: 'codex', model: 'gpt-5.6-sol', cwd: '/w/feature-pan-1',
      issueId: 'PAN-1', parentId: null, label: null, pid: null, pidStartTime: null, logFile: null,
    });
    await recordExternalTranscript(id, { sessionId: 'thread-1', harness: 'codex', path: rollout });

    const result = await buildAgentConversationResult(id);
    expect(result.status).toBe(200);
    expect(parseCodexConversationMessages).toHaveBeenCalledWith(rollout);
    expect(getAgentWorkspace).not.toHaveBeenCalled();
    if (result.status === 200) expect(result.body.streaming).toBe(false);
  });

  it('answers 404 for a registration with no transcript yet', async () => {
    const { id } = await registerExternalAgent({
      source: 'my-tool', externalId: 'run-1', harness: 'codex', model: null, cwd: null,
      issueId: null, parentId: null, label: null, pid: null, pidStartTime: null, logFile: null,
    });
    expect((await buildAgentConversationResult(id)).status).toBe(404);
    expect(getAgentWorkspace).not.toHaveBeenCalled();
  });
});
