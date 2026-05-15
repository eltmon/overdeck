import { describe, expect, it } from 'vitest';
import { getProxyPathname } from '../../src/lib/openai-compatible-proxy.js';

describe('OpenAI-compatible proxy routing', () => {
  it('routes Claude Code messages requests with query params by pathname', () => {
    expect(getProxyPathname('/nous/v1/messages?beta=true')).toBe('/nous/v1/messages');
  });

  it('routes model list requests by pathname', () => {
    expect(getProxyPathname('/nous/v1/models')).toBe('/nous/v1/models');
  });
});
