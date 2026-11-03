/**
 * PAN-4835 WI-6: the phone surface inventory as a scope test. Table A is the
 * fixture every phone screen must reach after this issue; table B is a
 * representative admin-only sample the phone must never reach. Table C
 * (fleet and linked-machine reach) belongs to PAN-4887 and is not asserted
 * here.
 */
import { describe, expect, it } from 'vitest';

import { PHONE_TOKEN_SCOPES, scopeSatisfies } from '../../../lib/access-tokens.js';
import { allowedRpcTags, requiredScopeFor, WS_RPC_UPGRADE_SCOPES } from '../route-scopes.js';

const PHONE_SURFACE_HTTP: ReadonlyArray<[string, string]> = [
  ['GET', '/api/activity'],
  ['GET', '/api/conversations/pending-input'],
  ['POST', '/api/conversations/c1/codex-approval'],
  ['POST', '/api/agents/a1/answer-question'],
  ['POST', '/api/conversations/c1/pi-ask-answer'],
  ['POST', '/api/conversations/c1/message'],
  ['GET', '/api/conversations'],
  ['GET', '/api/conversations/c1'],
  ['GET', '/api/conversations/c1/messages'],
  ['GET', '/api/conversations/c1/tool-body/t1'],
  ['GET', '/api/conversations/c1/diffs'],
  ['GET', '/api/conversations/c1/diffs/turn-1'],
  ['GET', '/api/conversations/c1/about'],
  ['GET', '/api/conversations/c1/bookmarks'],
  ['GET', '/api/conversations/c1/scheduled-messages'],
  ['GET', '/api/conversations/c1/kickoff'],
  ['POST', '/api/conversations/c1/kickoff'],
  ['GET', '/api/conversations/c1/attachments/a.png'],
  ['POST', '/api/conversations/c1/upload-image'],
  ['POST', '/api/conversations/c1/delete-image'],
  ['POST', '/api/conversations/c1/compact'],
  ['POST', '/api/conversations/c1/thinking-level'],
  ['POST', '/api/conversations/c1/resume'],
  ['POST', '/api/conversations/c1/abort'],
  ['POST', '/api/conversations/c1/stop'],
  ['POST', '/api/conversations/c1/plan-action'],
  ['POST', '/api/conversations/c1/pane-choice'],
  ['PUT', '/api/phones/self/push-key'],
  ['DELETE', '/api/phones/self'],
];

const PHONE_SURFACE_RPC = ['pan.getSnapshot', 'pan.replayEvents', 'pan.subscribeDomainEvents', 'pan.subscribeConversationMessages'];

const ADMIN_ONLY_HTTP: ReadonlyArray<[string, string]> = [
  ['GET', '/api/settings'],
  ['GET', '/api/color-themes'],
  ['POST', '/api/push/subscriptions'],
  ['GET', '/api/settings/available-models'],
  ['POST', '/api/conversations/c1/retitle'],
  ['POST', '/api/conversations/c1/archive'],
  ['POST', '/api/pairing/credentials'],
  ['GET', '/api/devices'],
  ['DELETE', '/api/devices/d1'],
];

const ADMIN_ONLY_RPC = ['pan.getAvailableEditors', 'pan.shellOpenInEditor', 'pan.readWorkspaceFile', 'pan.resolveFilePathExists', 'pan.terminalWrite', 'pan.deepWipe'];

describe('phone surface inventory (PAN-4835 WI-6)', () => {
  it('every inventory-A HTTP request resolves to a scope PHONE_TOKEN_SCOPES satisfies', () => {
    for (const [method, path] of PHONE_SURFACE_HTTP) {
      expect(scopeSatisfies(PHONE_TOKEN_SCOPES, requiredScopeFor(method, path)), `${method} ${path}`).toBe(true);
    }
  });

  it('allowedRpcTags(PHONE_TOKEN_SCOPES) contains every inventory-A RPC tag and none of the admin-only tags', () => {
    const allowed = allowedRpcTags([...PHONE_TOKEN_SCOPES]);
    for (const tag of PHONE_SURFACE_RPC) expect(allowed, tag).toContain(tag);
    for (const tag of ADMIN_ONLY_RPC) expect(allowed, tag).not.toContain(tag);
  });

  it('every inventory-B admin-only row still requires admin and is not satisfied by PHONE_TOKEN_SCOPES', () => {
    for (const [method, path] of ADMIN_ONLY_HTTP) {
      expect(requiredScopeFor(method, path), `${method} ${path}`).toBe('admin');
      expect(scopeSatisfies(PHONE_TOKEN_SCOPES, requiredScopeFor(method, path)), `${method} ${path}`).toBe(false);
    }
  });

  it('PHONE_TOKEN_SCOPES never carries admin or forward, and holds at least one WS_RPC_UPGRADE_SCOPES scope', () => {
    expect(PHONE_TOKEN_SCOPES).not.toContain('admin');
    expect(PHONE_TOKEN_SCOPES).not.toContain('forward');
    expect(WS_RPC_UPGRADE_SCOPES.some((scope) => PHONE_TOKEN_SCOPES.includes(scope))).toBe(true);
  });
});
