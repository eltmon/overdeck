/** PAN-4943 W-PR1: the six PR-link routes get a scope row so agent tokens stop getting 403. */
import { describe, expect, it } from 'vitest';

import { requiredScopeFor } from '../route-scopes.js';

describe('PR-link route scopes (PAN-4943 W-PR1)', () => {
  it('maps the four /api/conversations/:name/pull-requests routes', () => {
    expect(requiredScopeFor('GET', '/api/conversations/conv-a/pull-requests')).toBe('read:conversations');
    expect(requiredScopeFor('POST', '/api/conversations/conv-a/pull-requests')).toBe('tell');
    expect(requiredScopeFor('DELETE', '/api/conversations/conv-a/pull-requests')).toBe('tell');
    expect(requiredScopeFor('POST', '/api/conversations/conv-a/pull-requests/sync')).toBe('tell');
  });

  it('maps the two cross-conversation /api/pull-requests routes to read:state', () => {
    expect(requiredScopeFor('GET', '/api/pull-requests')).toBe('read:state');
    expect(requiredScopeFor('GET', '/api/pull-requests/conversations')).toBe('read:state');
  });

  it('a linked machine gets the same scope through /api/conversations/@<machine>/<rest>', () => {
    expect(requiredScopeFor('POST', '/api/conversations/@m1/conv-a/pull-requests')).toBe('tell');
  });
});
