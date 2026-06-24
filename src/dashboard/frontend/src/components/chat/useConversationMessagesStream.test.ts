import { describe, it, expect } from 'vitest';
import { shouldStreamConversationMessages } from './useConversationMessagesStream';

type GateArg = Parameters<typeof shouldStreamConversationMessages>[0];
const base = (over: Partial<GateArg>): GateArg => ({ name: 'conv-x', harness: 'claude-code', sessionAlive: true, id: 1, ...over });

describe('shouldStreamConversationMessages (PAN-1908 agent streaming)', () => {
  it('streams a real claude-code DB conversation (unchanged)', () => {
    expect(shouldStreamConversationMessages(base({ id: 42, harness: 'claude-code' }))).toBe(true);
    expect(shouldStreamConversationMessages(base({ id: 42, harness: null }))).toBe(true);
  });

  it('streams real pi/codex DB conversations via full JSONL snapshots', () => {
    expect(shouldStreamConversationMessages(base({ id: 42, harness: 'pi' }))).toBe(true);
    expect(shouldStreamConversationMessages(base({ id: 42, harness: 'codex' }))).toBe(true);
  });

  it('streams a synthetic pi work-agent session', () => {
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'agent-pan-1908', harness: 'pi' }))).toBe(true);
  });

  it('streams a synthetic codex agent session', () => {
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'agent-pan-2', harness: 'codex' }))).toBe(true);
  });

  it('does NOT stream a synthetic claude agent session (stays on poll)', () => {
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'agent-pan-3', harness: 'claude-code' }))).toBe(false);
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'agent-pan-3', harness: null }))).toBe(false);
  });

  it('streams planning/specialist pi sessions too', () => {
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'planning-pan-1908', harness: 'pi' }))).toBe(true);
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'specialist-x-merge', harness: 'codex' }))).toBe(true);
  });

  it('does not stream a non-agent synthetic name', () => {
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'draft-123', harness: 'pi' }))).toBe(false);
  });

  it('never streams a dead session', () => {
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'agent-pan-1908', harness: 'pi', sessionAlive: false }))).toBe(false);
    expect(shouldStreamConversationMessages(base({ id: 42, harness: 'claude-code', endedAt: '2026-01-01T00:00:00Z' }))).toBe(false);
  });
});
