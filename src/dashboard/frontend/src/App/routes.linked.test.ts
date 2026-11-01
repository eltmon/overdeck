/** PAN-4650 WI-8: /conv/@<env>/<name> opens a linked conversation; local /conv/<id> URLs keep working. */
import { describe, expect, it } from 'vitest';

import { buildConversationUrl, getConvIdFromPath } from './routes';

describe('linked conversation routes (PAN-4650 WI-8)', () => {
  it('ac2: parses /conv/@env/conv-x and round-trips it', () => {
    expect(getConvIdFromPath('/conv/@env-desk/conv-x')).toBe('@env-desk/conv-x');
    expect(buildConversationUrl('@env-desk/conv-x')).toBe('/conv/@env-desk/conv-x');
    expect(getConvIdFromPath(buildConversationUrl('@env-desk/conv-x'))).toBe('@env-desk/conv-x');
    expect(getConvIdFromPath(new URL(`http://x${buildConversationUrl('@env-desk/conv-x', 'terminal')}`).pathname)).toBe('@env-desk/conv-x');
  });

  it('keeps local ids and rejects other shapes', () => {
    expect(getConvIdFromPath('/conv/123')).toBe('123');
    expect(getConvIdFromPath('/conv/env-desk/conv-x')).toBeNull();
    expect(getConvIdFromPath('/conv/@env-desk/conv-x/extra')).toBeNull();
  });
});
