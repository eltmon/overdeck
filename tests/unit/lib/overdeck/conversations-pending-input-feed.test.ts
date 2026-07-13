import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let testHome: string;
let testDir: string;

async function resetDb() {
  const { closeOverdeckDatabaseSync } = await import('../../../../src/lib/overdeck/infra.js');
  closeOverdeckDatabaseSync();
}

beforeEach(() => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  testHome = join(tmpdir(), `pan-1520-feed-home-${suffix}`);
  testDir = join(tmpdir(), `pan-1520-feed-jsonl-${suffix}`);
  mkdirSync(testHome, { recursive: true });
  mkdirSync(testDir, { recursive: true });
  process.env.OVERDECK_HOME = testHome;
});

afterEach(async () => {
  await resetDb();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
  rmSync(testDir, { recursive: true, force: true });
});

function writeJsonl(filename: string, lines: unknown[]): string {
  const path = join(testDir, filename);
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return path;
}

function exitPlanMode(id: string, plan: string): unknown {
  return {
    type: 'tool_use',
    id,
    name: 'ExitPlanMode',
    input: { plan },
  };
}

function toolResult(toolUseId: string, content: string): unknown {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content,
  };
}

describe('getConversationsPendingInputFeed', () => {
  it('returns tmux-alive conversations with unresolved ExitPlanMode plans', async () => {
    const planPath = writeJsonl('pending-plan.jsonl', [
      {
        timestamp: '2026-07-13T10:00:00Z',
        type: 'assistant',
        message: { content: [exitPlanMode('plan-1', 'Implement the requested feed change.')] },
      },
    ]);
    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { getConversationsPendingInputFeed } = await import('../../../../src/lib/overdeck/conversation-reads.js');
    createConversation({
      name: 'plan-conv',
      tmuxSession: 'conv-plan',
      cwd: '/cwd',
      title: 'Plan conversation',
      issueId: 'PAN-1520',
    });

    const response = await getConversationsPendingInputFeed({
      listSessionNames: async () => ['conv-plan'],
      resolveSessionFile: async () => planPath,
    });

    expect(response.status).toBeUndefined();
    expect(response.body).toEqual([
      {
        name: 'plan-conv',
        title: 'Plan conversation',
        issueId: 'PAN-1520',
        pendingAskUserQuestion: null,
        pendingProposedPlan: {
          toolUseId: 'plan-1',
          plan: 'Implement the requested feed change.',
          createdAt: '2026-07-13T10:00:00Z',
        },
      },
    ]);
  });

  it('omits pendingProposedPlan after the ExitPlanMode tool_result resolves it', async () => {
    const planPath = writeJsonl('resolved-plan.jsonl', [
      {
        timestamp: '2026-07-13T10:00:00Z',
        type: 'assistant',
        message: { content: [exitPlanMode('plan-1', 'Implement the requested feed change.')] },
      },
      {
        timestamp: '2026-07-13T10:01:00Z',
        type: 'user',
        message: { content: [toolResult('plan-1', 'approved')] },
      },
    ]);
    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { getConversationsPendingInputFeed } = await import('../../../../src/lib/overdeck/conversation-reads.js');
    createConversation({ name: 'plan-conv', tmuxSession: 'conv-plan', cwd: '/cwd' });

    const response = await getConversationsPendingInputFeed({
      listSessionNames: async () => ['conv-plan'],
      resolveSessionFile: async () => planPath,
    });

    expect(response.status).toBeUndefined();
    expect(response.body).toEqual([]);
  });

  it('does not resolve session files for conversations without live tmux sessions', async () => {
    const planPath = writeJsonl('pending-plan.jsonl', [
      {
        timestamp: '2026-07-13T10:00:00Z',
        type: 'assistant',
        message: { content: [exitPlanMode('plan-1', 'Implement the requested feed change.')] },
      },
    ]);
    const resolved: string[] = [];
    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { getConversationsPendingInputFeed } = await import('../../../../src/lib/overdeck/conversation-reads.js');
    createConversation({ name: 'live-conv', tmuxSession: 'conv-live', cwd: '/cwd' });
    createConversation({ name: 'dead-conv', tmuxSession: 'conv-dead', cwd: '/cwd' });

    const response = await getConversationsPendingInputFeed({
      listSessionNames: async () => ['conv-live'],
      resolveSessionFile: async (conv) => {
        resolved.push(conv.name);
        return planPath;
      },
    });

    expect(response.status).toBeUndefined();
    expect(resolved).toEqual(['live-conv']);
    expect(response.body).toEqual([
      expect.objectContaining({
        name: 'live-conv',
        pendingProposedPlan: expect.objectContaining({ toolUseId: 'plan-1' }),
      }),
    ]);
  });
});
