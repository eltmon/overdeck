/**
 * PAN-4927 W-SELF1 WI-1: a self route's caller comes from an agent token only;
 * every other credential is 403 `not-an-agent-token`, and a token whose agent
 * or conversation is gone is 404 `agent-gone`.
 */
import { describe, expect, it } from 'vitest';

import type { DashboardCredential } from '../routes/dashboard-auth.js';
import { AGENT_GONE, NOT_AN_AGENT_TOKEN, type SelfCallerDeps, selfCallerFromCredential } from '../self-caller.js';

const deps: SelfCallerDeps = {
  getAgentState: (agentId) => (agentId === 'agent-pan-1' ? { workspace: '/w/feature-pan-1', issueId: 'PAN-1' } : null),
  getConversationByName: (name) => (name === 'abc' ? { cwd: '/p', tmuxSession: 'conv-abc', issueId: null } : null),
};

describe('selfCallerFromCredential', () => {
  const refused: Array<[string, DashboardCredential | null]> = [
    ['no credential', null],
    ['internal-token', { kind: 'internal-token' }],
    ['root-session', { kind: 'root-session' }],
    ['device', { kind: 'device', deviceId: 'dev-1', scopes: ['admin'] }],
    ['plain token', { kind: 'token', tokenId: 'tok-1', scopes: ['read:state'] }],
    ['token with an empty agentId', { kind: 'token', tokenId: 'tok-2', scopes: ['read:state'], agentId: '', agentKind: 'agent' }],
    ['token without an agentKind', { kind: 'token', tokenId: 'tok-3', scopes: ['read:state'], agentId: 'agent-pan-1' }],
    ['phone', { kind: 'phone', tokenId: 'tok-4', clientId: 'c-1', phoneKey: 'ab', scopes: ['read:state'] }],
    ['machine', { kind: 'machine', tokenId: 'tok-5', environmentId: 'env-1', scopes: ['read:state'] } as unknown as DashboardCredential],
  ];

  it.each(refused)('refuses %s with 403 not-an-agent-token', (_label, credential) => {
    expect(selfCallerFromCredential(credential, deps)).toEqual({ ok: false, status: 403, body: NOT_AN_AGENT_TOKEN });
  });

  it('pins the refusal body', () => {
    expect(NOT_AN_AGENT_TOKEN).toEqual({ error: 'self routes need an agent token', code: 'not-an-agent-token' });
    expect(AGENT_GONE).toEqual({ error: 'the agent for this token no longer exists', code: 'agent-gone' });
  });

  it('resolves an agent token to its workspace and issue', () => {
    const credential: DashboardCredential = { kind: 'token', tokenId: 'tok', scopes: ['read:state'], agentId: 'agent-pan-1', agentKind: 'agent', role: 'work' };
    expect(selfCallerFromCredential(credential, deps)).toEqual({
      ok: true,
      caller: { agentId: 'agent-pan-1', agentKind: 'agent', role: 'work', cwd: '/w/feature-pan-1', issueId: 'PAN-1', tmuxSession: null },
    });
  });

  it('resolves a conversation token to its cwd and tmux session', () => {
    const credential: DashboardCredential = { kind: 'token', tokenId: 'tok', scopes: ['read:state'], agentId: 'abc', agentKind: 'conversation', role: 'conversation' };
    expect(selfCallerFromCredential(credential, deps)).toEqual({
      ok: true,
      caller: { agentId: 'abc', agentKind: 'conversation', role: 'conversation', cwd: '/p', issueId: null, tmuxSession: 'conv-abc' },
    });
  });

  it('gives a null role when the token record has none', () => {
    const credential: DashboardCredential = { kind: 'token', tokenId: 'tok', scopes: ['read:state'], agentId: 'agent-pan-1', agentKind: 'agent' };
    const result = selfCallerFromCredential(credential, deps);
    expect(result.ok && result.caller.role).toBeNull();
  });

  it('maps an empty agent issueId to null', () => {
    const result = selfCallerFromCredential(
      { kind: 'token', tokenId: 'tok', scopes: ['read:state'], agentId: 'agent-pan-2', agentKind: 'agent' },
      { ...deps, getAgentState: () => ({ workspace: '/w/x', issueId: '' }) },
    );
    expect(result.ok && result.caller.issueId).toBeNull();
  });

  const gone: Array<[string, DashboardCredential, SelfCallerDeps]> = [
    ['a missing agent state', { kind: 'token', tokenId: 'tok', scopes: [], agentId: 'agent-pan-9', agentKind: 'agent' }, deps],
    [
      'an empty workspace',
      { kind: 'token', tokenId: 'tok', scopes: [], agentId: 'agent-pan-1', agentKind: 'agent' },
      { ...deps, getAgentState: () => ({ workspace: '', issueId: 'PAN-1' }) },
    ],
    ['a missing conversation row', { kind: 'token', tokenId: 'tok', scopes: [], agentId: 'gone', agentKind: 'conversation' }, deps],
    [
      'an empty conversation cwd',
      { kind: 'token', tokenId: 'tok', scopes: [], agentId: 'abc', agentKind: 'conversation' },
      { ...deps, getConversationByName: () => ({ cwd: '', tmuxSession: 'conv-abc', issueId: null }) },
    ],
  ];

  it.each(gone)('refuses %s with 404 agent-gone', (_label, credential, lookupDeps) => {
    expect(selfCallerFromCredential(credential, lookupDeps)).toEqual({ ok: false, status: 404, body: AGENT_GONE });
  });

  it('does not catch a throwing lookup', () => {
    const throwing: SelfCallerDeps = {
      ...deps,
      getAgentState: () => {
        throw new Error('EACCES');
      },
    };
    expect(() =>
      selfCallerFromCredential({ kind: 'token', tokenId: 'tok', scopes: [], agentId: 'agent-pan-1', agentKind: 'agent' }, throwing),
    ).toThrow('EACCES');
  });
});
