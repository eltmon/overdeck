import { describe, expect, it } from 'vitest';
import { subagentRoutingNotice } from '../subagentRouting';
import type { ChatMessage, SubagentSummary } from '../../components/chat/chat-types';

function subagent(overrides: Partial<SubagentSummary> = {}): SubagentSummary {
  return {
    agentId: 'agent-1',
    agentType: 'general-purpose',
    description: 'Investigate flaky test',
    toolUseId: 'toolu_1',
    spawnDepth: 1,
    status: 'running',
    background: true,
    ...overrides,
  };
}

function userMessage(id: string, createdAt: string, text = 'hello'): ChatMessage {
  return { id, role: 'user', text, createdAt };
}

describe('subagentRoutingNotice (PAN-4247)', () => {
  it('returns "routed" when the newest human input is newer than the newest main user message (AC1)', () => {
    const sub = subagent({
      humanInputs: [{ id: 'sc-1', text: 'please pause', createdAt: '2026-09-27T10:00:05.000Z' }],
    });
    const messages = [userMessage('main-1', '2026-09-27T10:00:00.000Z')];

    expect(subagentRoutingNotice([sub], messages)).toEqual({
      kind: 'routed', key: 'sc-1', agentId: 'agent-1', description: 'Investigate flaky test',
    });
  });

  it('returns "running" for the first background running subagent when no human input is newer (AC1)', () => {
    const sub = subagent({
      humanInputs: [{ id: 'sc-1', text: 'please pause', createdAt: '2026-09-27T10:00:00.000Z' }],
    });
    const messages = [userMessage('main-1', '2026-09-27T10:00:05.000Z')];

    expect(subagentRoutingNotice([sub], messages)).toEqual({
      kind: 'running', key: 'agent-1', agentId: 'agent-1', description: 'Investigate flaky test',
    });
  });

  it('returns null when there is no human input and no running background subagent (AC1)', () => {
    const sub = subagent({ status: 'done', background: true });
    expect(subagentRoutingNotice([sub], [])).toBeNull();
    expect(subagentRoutingNotice([], [userMessage('main-1', '2026-09-27T10:00:00.000Z')])).toBeNull();
  });

  it('ignores optimistic bubbles when finding the newest main user message, so a routed notice still fires (AC2)', () => {
    const sub = subagent({
      humanInputs: [{ id: 'sc-1', text: 'please pause', createdAt: '2026-09-27T10:00:05.000Z' }],
    });
    const messages = [
      userMessage('main-1', '2026-09-27T10:00:00.000Z'),
      userMessage('optimistic-2', '2026-09-27T10:00:10.000Z'),
    ];

    expect(subagentRoutingNotice([sub], messages)?.kind).toBe('routed');
  });

  it('does not return "routed" when a real main-transcript message is newer than every human input (AC2)', () => {
    const sub = subagent({
      humanInputs: [{ id: 'sc-1', text: 'please pause', createdAt: '2026-09-27T10:00:00.000Z' }],
      status: 'done',
      background: true,
    });
    const messages = [userMessage('main-1', '2026-09-27T10:00:05.000Z')];

    expect(subagentRoutingNotice([sub], messages)).toBeNull();
  });

  it('still returns "routed" when the only newer main message is a task-notification relay (AC2)', () => {
    const sub = subagent({
      humanInputs: [{ id: 'sc-1', text: 'please pause', createdAt: '2026-09-27T10:00:05.000Z' }],
      status: 'done',
      background: true,
    });
    const messages = [
      userMessage('main-1', '2026-09-27T10:00:00.000Z'),
      userMessage('main-2', '2026-09-27T10:00:10.000Z', '<task-notification><tool-use-id>abc</tool-use-id></task-notification>'),
    ];

    expect(subagentRoutingNotice([sub], messages)).toEqual({
      kind: 'routed', key: 'sc-1', agentId: 'agent-1', description: 'Investigate flaky test',
    });
  });
});
