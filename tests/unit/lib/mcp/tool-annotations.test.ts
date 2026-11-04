/**
 * PAN-4927 W-MCP1: every tool's `scope` and `audience`, and the structural
 * `hasAgentId` check both transports use to set `isAgent`.
 */
import { describe, expect, it } from 'vitest';

import { requiredScopeFor } from '../../../../src/dashboard/server/route-scopes.js';
import { ALL_TOOLS, hasAgentId } from '../../../../src/lib/mcp/server.js';
import { SELF_TOOLS } from '../../../../src/lib/mcp/tools-self.js';

const SINGLE_ROUTE_PATHS: Record<string, { method: string; path: string }> = {
  list_machines: { method: 'GET', path: '/api/fleet/machines' },
  list_conversations: { method: 'GET', path: '/api/conversations' },
  search_conversations: { method: 'GET', path: '/api/palette/search' },
  read_conversation: { method: 'GET', path: '/api/conversations/conv-a/messages' },
  send_message: { method: 'POST', path: '/api/conversations/conv-a/message' },
  start_conversation: { method: 'POST', path: '/api/fleet/conversations' },
  start_worker: { method: 'POST', path: '/api/fleet/workers' },
  list_pending_input: { method: 'GET', path: '/api/conversations/pending-input' },
  answer_permission: { method: 'POST', path: '/api/conversations/conv-a/permission' },
  wait_job: { method: 'GET', path: '/api/self/jobs/abc/wait' },
};

describe('MCP tool annotations (PAN-4927 W-MCP1)', () => {
  it('every tool but SELF_TOOLS declares audience: any, and every SELF_TOOLS tool declares audience: agent', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.audience, tool.name).toBe(SELF_TOOLS.includes(tool) ? 'agent' : 'any');
    }
    expect(SELF_TOOLS.length).toBeGreaterThan(0);
  });

  it('each single-route tool\'s scope equals the route-scope table entry for its route', () => {
    for (const [name, route] of Object.entries(SINGLE_ROUTE_PATHS)) {
      const tool = ALL_TOOLS.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool!.scope).toBe(requiredScopeFor(route.method, route.path));
    }
  });

  it('answer_question needs the approve scope', () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'answer_question');
    expect(tool).toBeDefined();
    expect(tool!.scope).toBe('approve');
  });

  it('hasAgentId is true only for a non-empty string agentId', () => {
    expect(hasAgentId({ kind: 'token', agentId: 'agent-pan-1' })).toBe(true);
    expect(hasAgentId({ kind: 'token' })).toBe(false);
    expect(hasAgentId({ agentId: '' })).toBe(false);
    expect(hasAgentId({ agentId: 42 })).toBe(false);
  });
});
