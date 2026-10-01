import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_SCOPES } from '../../../src/lib/access-tokens.js';
import { ACCESS_TOKEN_SCOPE_OPTIONS } from '../../../src/dashboard/frontend/src/components/Settings/sections/accessTokenScopes';

describe('access token scopes parity (PAN-4435 D-5)', () => {
  it('lists the same scope ids, in the same order, as the backend', () => {
    expect(ACCESS_TOKEN_SCOPE_OPTIONS.map((o) => o.id)).toEqual([...ACCESS_TOKEN_SCOPES]);
  });
});
