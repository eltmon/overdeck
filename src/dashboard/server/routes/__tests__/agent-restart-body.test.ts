/**
 * PAN-4256: parseAgentRestartBody consolidates the /api/agents/:id/restart
 * body destructure plus model/effort validation into one parse call.
 */
import { describe, expect, it } from 'vitest';

import { parseAgentRestartBody } from '../agents/shared.js';

describe('parseAgentRestartBody', () => {
  it('defaults graceful to true and force to false for an empty body', () => {
    const result = parseAgentRestartBody({});

    expect(result).toMatchObject({ ok: true, value: { graceful: true, force: false } });
  });

  it('returns ok:false with a message naming the five levels for an invalid effort', () => {
    const result = parseAgentRestartBody({ effort: 'ultra' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/low, medium, high, xhigh, max/);
  });

  it('carries an explicit model, harness, and effort through', () => {
    const result = parseAgentRestartBody({ model: 'claude-opus-5-5', harness: 'claude-code', effort: 'low', force: true, graceful: false });

    expect(result).toMatchObject({
      ok: true,
      value: { model: 'claude-opus-5-5', harness: 'claude-code', effort: 'low', force: true, graceful: false },
    });
  });

  it('rejects an invalid model before effort is even considered', () => {
    const result = parseAgentRestartBody({ model: 'bad model; rm -rf /' });

    expect(result.ok).toBe(false);
  });
});
