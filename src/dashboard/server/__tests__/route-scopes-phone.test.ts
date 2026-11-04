/**
 * PAN-4835 WI-6: the phone surface inventory as a scope test. Table A is the
 * fixture every phone screen must reach after this issue; table B is a
 * representative admin-only sample the phone must never reach. Table C
 * (fleet and linked-machine reach) belongs to PAN-4887 and is not asserted
 * here.
 *
 * PAN-4837 WI-23: the phone app's logged run (`apps/mobile/request-log.json`,
 * recorded on the Android emulator against a real machine) must stay inside
 * the phone token's scopes, request by request.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PHONE_TOKEN_SCOPES, scopeSatisfies } from '../../../lib/access-tokens.js';
import { REMOTE_GATE_ALLOWLIST } from '../remote-request-gate.js';
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
  ['PUT', '/api/phones/self/notification-preferences'],
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

interface PhoneRequestLog {
  http: Array<{ method: string; path: string; status: number }>;
  rpc: string[];
}

/** Throws, naming the first entry, unless every logged request is one the phone token may make. */
function assertPhoneRequests(log: PhoneRequestLog): void {
  const allowed = allowedRpcTags([...PHONE_TOKEN_SCOPES]);
  for (const { method, path } of log.http) {
    if (REMOTE_GATE_ALLOWLIST.has(`${method} ${path}`)) continue;
    const required = requiredScopeFor(method, path);
    if (!scopeSatisfies(PHONE_TOKEN_SCOPES, required)) {
      throw new Error(`${method} ${path} needs ${required}, which the phone token does not have`);
    }
  }
  for (const tag of log.rpc) {
    if (!allowed.includes(tag)) throw new Error(`RPC ${tag} is not allowed for the phone token`);
  }
}

const PHONE_APP_REQUEST_LOG = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../apps/mobile/request-log.json', import.meta.url)), 'utf8'),
) as PhoneRequestLog;

describe('phone app logged requests (PAN-4837 WI-23)', () => {
  it('the log covers HTTP and RPC traffic', () => {
    expect(PHONE_APP_REQUEST_LOG.http.length).toBeGreaterThan(0);
    expect(PHONE_APP_REQUEST_LOG.rpc.length).toBeGreaterThan(0);
  });

  it('every logged request is credential-free or within PHONE_TOKEN_SCOPES', () => {
    expect(() => assertPhoneRequests(PHONE_APP_REQUEST_LOG)).not.toThrow();
  });

  it('names the entry when a logged request needs a scope the phone lacks', () => {
    expect(() => assertPhoneRequests({ http: [{ method: 'GET', path: '/api/settings', status: 403 }], rpc: [] })).toThrow(
      'GET /api/settings needs admin',
    );
    expect(() => assertPhoneRequests({ http: [], rpc: ['pan.getAvailableEditors'] })).toThrow('RPC pan.getAvailableEditors');
  });
});
