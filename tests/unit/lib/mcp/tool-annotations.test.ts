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
  schedule_message: { method: 'POST', path: '/api/conversations/conv-a/scheduled-messages' },
  schedule_recurring: { method: 'POST', path: '/api/conversations/conv-a/schedules' },
  answer_permission: { method: 'POST', path: '/api/conversations/conv-a/permission' },
  answer_pane_choice: { method: 'POST', path: '/api/conversations/conv-a/pane-choice' },
  answer_codex_approval: { method: 'POST', path: '/api/conversations/conv-a/codex-approval' },
  answer_pi_ask: { method: 'POST', path: '/api/conversations/conv-a/pi-ask-answer' },
  answer_plan: { method: 'POST', path: '/api/conversations/conv-a/plan-action' },
  answer_agent_plan: { method: 'POST', path: '/api/agents/agent-pan-1/plan-action' },
  answer_agent_permission: { method: 'POST', path: '/api/agents/agent-pan-1/permissions/req-1/respond' },
  wait_job: { method: 'GET', path: '/api/self/jobs/abc/wait' },
  request_secret: { method: 'POST', path: '/api/self/secret-requests' },
  secret_wait: { method: 'GET', path: '/api/self/secret-requests/abc/wait' },
  memory_add: { method: 'POST', path: '/api/self/memory/facts' },
  memory_search: { method: 'POST', path: '/api/self/memory/search' },
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

  it('list_scheduled, update_scheduled and delete_scheduled scopes match both routes each covers (PAN-4927 W-SCHED1)', () => {
    const listScheduled = ALL_TOOLS.find((t) => t.name === 'list_scheduled');
    expect(listScheduled!.scope).toBe(requiredScopeFor('GET', '/api/conversations/conv-a/scheduled-messages'));
    expect(listScheduled!.scope).toBe(requiredScopeFor('GET', '/api/conversations/conv-a/schedules'));

    const updateScheduled = ALL_TOOLS.find((t) => t.name === 'update_scheduled');
    expect(updateScheduled!.scope).toBe(requiredScopeFor('PATCH', '/api/conversations/conv-a/scheduled-messages/1'));
    expect(updateScheduled!.scope).toBe(requiredScopeFor('PATCH', '/api/conversations/conv-a/schedules/1'));

    const deleteScheduled = ALL_TOOLS.find((t) => t.name === 'delete_scheduled');
    expect(deleteScheduled!.scope).toBe(requiredScopeFor('DELETE', '/api/conversations/conv-a/scheduled-messages/1'));
    expect(deleteScheduled!.scope).toBe(requiredScopeFor('DELETE', '/api/conversations/conv-a/schedules/1'));
  });

  it('list_pending_input needs read:conversations, matching both GET /api/needs-you and GET /api/fleet/needs-you', () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'list_pending_input');
    expect(tool).toBeDefined();
    expect(tool!.scope).toBe('read:conversations');
    expect(requiredScopeFor('GET', '/api/needs-you')).toBe(tool!.scope);
    expect(requiredScopeFor('GET', '/api/fleet/needs-you')).toBe(tool!.scope);
  });

  it('hasAgentId is true only for a non-empty string agentId', () => {
    expect(hasAgentId({ kind: 'token', agentId: 'agent-pan-1' })).toBe(true);
    expect(hasAgentId({ kind: 'token' })).toBe(false);
    expect(hasAgentId({ agentId: '' })).toBe(false);
    expect(hasAgentId({ agentId: 42 })).toBe(false);
  });
});
