import { describe, expect, it, vi } from 'vitest';

const { updateIssueRecord } = vi.hoisted(() => ({
  updateIssueRecord: vi.fn(async (_project, _issueId, mutator) => {
    const record: Record<string, unknown> = { swarm: { policy: { inspection: 'required' } } };
    await mutator(record);
    return record;
  }),
}));

vi.mock('../../../lib/pan-dir/record-update.js', () => ({ updateIssueRecord }));

import { hasStartPolicyOverrides, parseStartPolicyOverrides, persistStartPolicyOverrides } from '../start-policy-overrides.js';

describe('pan start policy overrides', () => {
  it('parses all supported start-time policy flags', () => {
    expect(parseStartPolicyOverrides({ model: 'gpt-5.6-sol', swarm: 'off', reviewMode: 'full', reviewModel: 'gpt-5.5' })).toEqual({
      workModel: 'gpt-5.6-sol', swarmMode: 'off', reviewMode: 'full', reviewModel: 'gpt-5.5',
    });
  });

  it.each([
    [{ swarm: 'sometimes' }, 'Invalid --swarm value'],
    [{ reviewMode: 'fast' }, 'Invalid --review-mode value'],
  ])('rejects invalid policy flag values', (options, message) => {
    expect(() => parseStartPolicyOverrides(options)).toThrow(message);
  });

  it('leaves inherited policy untouched when flags are omitted', async () => {
    const overrides = parseStartPolicyOverrides({});
    expect(hasStartPolicyOverrides(overrides)).toBe(false);
    await persistStartPolicyOverrides({} as never, 'PAN-2704', overrides);
    expect(updateIssueRecord).not.toHaveBeenCalled();
  });

  it('creates or updates the issue record through the canonical writer', async () => {
    await persistStartPolicyOverrides({} as never, 'PAN-2704', {
      workModel: 'gpt-5.6-sol', swarmMode: 'off', reviewMode: 'full', reviewModel: 'gpt-5.5',
    });
    expect(updateIssueRecord).toHaveBeenCalledWith({}, 'PAN-2704', expect.any(Function));
    await expect(updateIssueRecord.mock.results[0].value).resolves.toEqual({
      workModel: 'gpt-5.6-sol', reviewMode: 'full', reviewModel: 'gpt-5.5',
      swarm: { policy: { inspection: 'required', mode: 'off' } },
    });
  });
});
