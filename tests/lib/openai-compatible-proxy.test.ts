import { describe, expect } from 'vitest';
import { it } from '@effect/vitest';
import { Effect } from 'effect';
import { getProxyPathname } from '../../src/lib/openai-compatible-proxy.js';

describe('OpenAI-compatible proxy routing', () => {
  it.effect('routes Claude Code messages requests with query params by pathname', () =>
    Effect.sync(() => {
      expect(getProxyPathname('/nous/v1/messages?beta=true')).toBe('/nous/v1/messages');
    })
  );

  it.effect('routes model list requests by pathname', () =>
    Effect.sync(() => {
      expect(getProxyPathname('/nous/v1/models')).toBe('/nous/v1/models');
    })
  );
});
