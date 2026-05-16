import { describe, expect, it } from 'vitest';
import { isSubagentHookPayload } from '../../../src/lib/memory/subagent-filter.js';
import { memoryTurnHookResponse } from '../../../src/dashboard/server/routes/hooks.js';

describe('memory subagent filter', () => {
  it('detects Claude Code subagent hook payloads by agent_id presence', () => {
    expect(isSubagentHookPayload({ agent_id: 'agent-abc', session_id: 'session-1' })).toBe(true);
    expect(isSubagentHookPayload({ agent_id: '  ' })).toBe(false);
    expect(isSubagentHookPayload({ session_id: 'session-1' })).toBe(false);
    expect(isSubagentHookPayload(null)).toBe(false);
  });

  it('returns 204 for memory turn hooks from subagents', () => {
    const response = memoryTurnHookResponse({ agent_id: 'agent-abc', session_id: 'session-1' });

    expect(response?.status).toBe(204);
  });

  it('lets primary-agent memory turn hooks continue to the pipeline', () => {
    expect(memoryTurnHookResponse({ session_id: 'session-1' })).toBeNull();
  });
});
