/**
 * PAN-2351 W3: the route-scope table. Every row names a real surface (checked
 * against the no-loss matrix, never a grep of source files), and anything the
 * table does not list needs `admin`.
 */
import { describe, expect, it } from 'vitest';

import { NO_LOSS_MATRIX } from '../../../../tests/unit/lib/overdeck/no-loss-matrix.js';
import { requiredScopeFor, ROUTE_SCOPES, WS_TERMINAL_SCOPE } from '../route-scopes.js';

describe('route-scope table (PAN-2351)', () => {
  it('lists only surfaces that exist in the no-loss matrix', () => {
    const surfaces = new Set(NO_LOSS_MATRIX.map((entry) => entry.surface));
    for (const row of ROUTE_SCOPES) {
      expect(surfaces.has(`${row.method} ${row.path}`), `${row.method} ${row.path}`).toBe(true);
    }
  });

  it('maps listed routes to their scope and everything else to admin', () => {
    expect(requiredScopeFor('GET', '/events/stream')).toBe('read:events');
    expect(requiredScopeFor('GET', '/api/issues')).toBe('read:state');
    expect(requiredScopeFor('GET', '/api/registered-projects')).toBe('read:state');
    expect(requiredScopeFor('POST', '/api/registered-projects')).toBe('admin');
    expect(requiredScopeFor('GET', '/api/conversations/abc')).toBe('read:conversations');
    expect(requiredScopeFor('GET', '/api/conversations/abc/messages')).toBe('read:conversations');
    expect(requiredScopeFor('POST', '/api/agents/pan-1/tell')).toBe('tell');
    expect(requiredScopeFor('POST', '/api/conversations/abc/message')).toBe('tell');
    expect(WS_TERMINAL_SCOPE).toBe('operate');

    expect(requiredScopeFor('GET', '/api/settings')).toBe('admin');
    expect(requiredScopeFor('GET', '/api/agents/pan-1/tell')).toBe('admin');
    expect(requiredScopeFor('GET', '/api/conversations/a/b/messages')).toBe('admin');
    expect(requiredScopeFor('GET', '/api/issues/')).toBe('admin');
    expect(requiredScopeFor('GET', '/API/issues')).toBe('admin');
    expect(requiredScopeFor('POST', '/api/agents//tell')).toBe('admin');
  });

  it('maps the eight approval routes to approve (PAN-4649 FR-2)', () => {
    for (const path of [
      '/api/conversations/conv-1/permission',
      '/api/conversations/conv-1/pane-choice',
      '/api/conversations/conv-1/pi-ask-answer',
      '/api/conversations/conv-1/codex-approval',
      '/api/conversations/conv-1/plan-action',
      '/api/agents/agent-pan-1/answer-question',
      '/api/agents/agent-pan-1/plan-action',
      '/api/agents/agent-pan-1/permissions/req-1/respond',
    ]) {
      expect(requiredScopeFor('POST', path), path).toBe('approve');
    }
    expect(requiredScopeFor('POST', '/api/conversations/conv-1/archive')).toBe('admin');
  });

  it('maps the routes the MCP tools proxy to (PAN-4649 FR-3)', () => {
    expect(requiredScopeFor('GET', '/api/palette/search')).toBe('read:conversations');
    expect(requiredScopeFor('POST', '/api/conversations')).toBe('operate');
    expect(requiredScopeFor('POST', '/api/workers')).toBe('operate');
    expect(requiredScopeFor('POST', '/api/workers/register')).toBe('admin');
    expect(requiredScopeFor('PUT', '/api/settings')).toBe('admin');
  });

  it('maps the recurring-schedule routes (PAN-4927 W-SCHED1)', () => {
    expect(requiredScopeFor('GET', '/api/conversations/conv-a/schedules')).toBe('read:conversations');
    expect(requiredScopeFor('POST', '/api/conversations/conv-a/schedules')).toBe('tell');
    expect(requiredScopeFor('PATCH', '/api/conversations/conv-a/schedules/3')).toBe('tell');
    expect(requiredScopeFor('DELETE', '/api/conversations/conv-a/schedules/3')).toBe('tell');
    expect(requiredScopeFor('POST', '/api/conversations/@desk/conv-a/schedules')).toBe('tell');
    expect(requiredScopeFor('PUT', '/api/conversations/conv-a/schedules/3')).toBe('admin');
    expect(requiredScopeFor('DELETE', '/api/conversations/conv-a/schedules')).toBe('admin');
  });
});
