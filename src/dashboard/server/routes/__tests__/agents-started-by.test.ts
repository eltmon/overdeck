import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpServerRequest } from 'effect/unstable/http';
import {
  isInternalAgentRequest,
  resolveRequestedStartedBy,
} from '../agents/shared.js';

const INTERNAL_TOKEN_HEADER = 'x-overdeck-internal-token';

describe('agent spawn provenance boundary', () => {
  let previousInternalToken: string | undefined;

  beforeEach(() => {
    previousInternalToken = process.env['OVERDECK_INTERNAL_TOKEN'];
    process.env['OVERDECK_INTERNAL_TOKEN'] = 'test-internal-token';
  });

  afterEach(() => {
    if (previousInternalToken === undefined) delete process.env['OVERDECK_INTERNAL_TOKEN'];
    else process.env['OVERDECK_INTERNAL_TOKEN'] = previousInternalToken;
  });

  it('derives browser provenance server-side instead of trusting the request body', () => {
    expect(resolveRequestedStartedBy('flywheel:forged', false)).toBe('operator:dashboard');
    expect(resolveRequestedStartedBy(undefined, false)).toBe('operator:dashboard');
  });

  it('allows only registered internal provenance tokens for internal callers', () => {
    expect(resolveRequestedStartedBy('operator:cli:pan-start', true)).toBe('operator:cli:pan-start');
    expect(resolveRequestedStartedBy('operator:cli:pan-plan', true)).toBe('operator:cli:pan-plan');
    expect(resolveRequestedStartedBy('flywheel:RUN-42', true)).toBe('flywheel:RUN-42');
    expect(resolveRequestedStartedBy('planning-auto-handoff', true)).toBe('planning-auto-handoff');
    expect(resolveRequestedStartedBy('resume-agent', true)).toBe('resume-agent');
    expect(() => resolveRequestedStartedBy('flywheel:forged', true)).toThrow(
      'Invalid internal startedBy provenance token.',
    );
    expect(() => resolveRequestedStartedBy(undefined, true)).toThrow(
      'Invalid internal startedBy provenance token.',
    );
  });

  it('recognizes internal callers only when the internal token matches', async () => {
    const request = (token: string) => HttpServerRequest.fromWeb(new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { [INTERNAL_TOKEN_HEADER]: token },
    }));

    await expect(isInternalAgentRequest(request('test-internal-token'))).resolves.toBe(true);
    await expect(isInternalAgentRequest(request('wrong-token'))).resolves.toBe(false);
  });
});
