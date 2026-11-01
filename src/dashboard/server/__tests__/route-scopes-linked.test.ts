/** PAN-4651 WI-28 (D-4651-17): a linked conversation needs the scope its inner route needs here. */
import { describe, expect, it } from 'vitest';

import { requiredScopeFor } from '../route-scopes.js';

describe('linked conversation scopes (D-4651-17)', () => {
  it('maps /api/conversations/@<machine>/<rest> to the scope of /api/conversations/<rest>', () => {
    expect(requiredScopeFor('GET', '/api/conversations/@desk/conv-a/messages')).toBe(requiredScopeFor('GET', '/api/conversations/conv-a/messages'));
    expect(requiredScopeFor('GET', '/api/conversations/@desk/conv-a/messages')).toBe('read:conversations');
    expect(requiredScopeFor('POST', '/api/conversations/@desk/conv-a/message')).toBe('tell');
    expect(requiredScopeFor('POST', '/api/conversations/@desk/conv-a/permission')).toBe('approve');
  });

  it('an unlisted inner route, or a bare machine prefix, stays admin', () => {
    expect(requiredScopeFor('DELETE', '/api/conversations/@desk/conv-a')).toBe('admin');
    expect(requiredScopeFor('GET', '/api/conversations/@desk')).toBe('admin');
    expect(requiredScopeFor('PUT', '/api/settings')).toBe('admin');
  });
});
