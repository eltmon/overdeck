/**
 * PAN-4278 — POST /api/hooks/permission-event records PermissionRequest hooks
 * per conversation and agent key, and only that agent's clearing event removes
 * its entry.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createConversation } from '../../../../lib/overdeck/conversations.js';
import {
  listPermissionRequests,
  resetPermissionRegistryForTests,
} from '../../../../lib/overdeck/conversation-permission-registry.js';
import { handlePermissionEventBody } from '../../../server/routes/hooks.js';

const emittedEvents: Array<{ type: string; payload: { conversationName: string; waiting: boolean; toolName?: string } }> = [];

vi.mock('../../../server/event-store.js', () => ({
  getEventStore: () => ({
    emitOnly: (event: (typeof emittedEvents)[number]) => {
      emittedEvents.push(event);
    },
  }),
}));

const SESSION = 'session-permission-event';
const CONV = 'perm-conv';
let testHome: string;
let transcriptPath: string;

function hook(event: string, extra: Record<string, unknown> = {}) {
  return handlePermissionEventBody(
    { session_id: SESSION, transcript_path: transcriptPath, hook_event_name: event, ...extra },
    { now: () => new Date('2026-09-27T15:32:21.000Z') },
  );
}

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-hooks-permission-event-test-'));
  process.env.OVERDECK_HOME = testHome;
  emittedEvents.length = 0;
  resetPermissionRegistryForTests();
  transcriptPath = join(testHome, `${SESSION}.jsonl`);
  createConversation({
    name: CONV,
    tmuxSession: 'tmux-perm-conv',
    cwd: '/tmp',
    claudeSessionId: SESSION,
    title: 'Permission conv',
    titleSource: 'default',
  });
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('handlePermissionEventBody', () => {
  it('records a main-thread PermissionRequest', async () => {
    const result = await hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -f queue/*' } });

    expect(result).toEqual({ ok: true, conversationName: CONV, waiting: true });
    expect(listPermissionRequests(CONV)).toEqual([{
      agentKey: 'main',
      agentId: null,
      agentType: null,
      agentDescription: null,
      toolName: 'Bash',
      toolInputPreview: 'rm -f queue/*',
      requestedAt: '2026-09-27T15:32:21.000Z',
    }]);
    expect(emittedEvents.at(-1)).toMatchObject({
      type: 'conversation.permission_changed',
      payload: { conversationName: CONV, waiting: true, toolName: 'Bash' },
    });
  });

  it('records a subagent PermissionRequest with its meta.json description', async () => {
    const subagents = join(testHome, SESSION, 'subagents');
    mkdirSync(subagents, { recursive: true });
    writeFileSync(join(subagents, 'agent-a9ef2e8f.meta.json'), JSON.stringify({ description: 'Research Orca onboarding flow' }));

    await hook('PermissionRequest', {
      agent_id: 'a9ef2e8f',
      agent_type: 'general-purpose',
      tool_name: 'Edit',
      tool_input: { file_path: '/tmp/probe/a.ts', old_string: 'x', new_string: 'y' },
    });

    expect(listPermissionRequests(CONV)).toEqual([expect.objectContaining({
      agentKey: 'a9ef2e8f',
      agentId: 'a9ef2e8f',
      agentType: 'general-purpose',
      agentDescription: 'Research Orca onboarding flow',
      toolName: 'Edit',
      toolInputPreview: '/tmp/probe/a.ts',
    })]);
  });

  it('a main PostToolUse does not clear a waiting subagent', async () => {
    await hook('PermissionRequest', { agent_id: 'sub-1', tool_name: 'Bash', tool_input: { command: 'rm -f "$Q"/*' } });
    const result = await hook('PostToolUse', { tool_name: 'Read' });

    expect(result.waiting).toBe(true);
    expect(listPermissionRequests(CONV).map((e) => e.agentKey)).toEqual(['sub-1']);
    expect(emittedEvents.at(-1)?.payload.waiting).toBe(true);
  });

  it('a subagent PermissionDenied clears only that subagent', async () => {
    await hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } });
    await hook('PermissionRequest', { agent_id: 'sub-1', tool_name: 'Bash', tool_input: { command: 'rm -f x' } });
    const result = await hook('PermissionDenied', { agent_id: 'sub-1', tool_name: 'Bash' });

    expect(result.waiting).toBe(true);
    expect(listPermissionRequests(CONV).map((e) => e.agentKey)).toEqual(['main']);
  });

  it('a PermissionDenied with the same agent_id removes the only entry and reports waiting=false', async () => {
    await hook('PermissionRequest', { agent_id: 'sub-1', tool_name: 'Bash', tool_input: { command: 'rm -f x' } });
    const result = await hook('PermissionDenied', { agent_id: 'sub-1', tool_name: 'Bash' });

    expect(result).toEqual({ ok: true, conversationName: CONV, waiting: false });
    expect(listPermissionRequests(CONV)).toEqual([]);
    expect(emittedEvents.at(-1)?.payload.waiting).toBe(false);
  });

  it('waiting=false once every entry clears', async () => {
    await hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } });
    await hook('PermissionRequest', { agent_id: 'sub-1', tool_name: 'Bash', tool_input: { command: 'rm -f x' } });
    await hook('Stop');
    const result = await hook('PostToolUseFailure', { agent_id: 'sub-1', tool_name: 'Bash' });

    expect(result).toEqual({ ok: true, conversationName: CONV, waiting: false });
    expect(listPermissionRequests(CONV)).toEqual([]);
    expect(emittedEvents.at(-1)?.payload.waiting).toBe(false);
  });

  it('ignores unrelated hook events and unknown sessions', async () => {
    expect(await hook('SessionStart')).toEqual({ ok: true });
    expect(await handlePermissionEventBody({ session_id: 'nope', hook_event_name: 'PermissionRequest' })).toEqual({ ok: true });
    expect(emittedEvents).toEqual([]);
  });
});
