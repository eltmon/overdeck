import { beforeEach, describe, expect, it, vi } from 'vitest';

// PAN-3077: definition-less role runs (review sub-roles, standing supervisor)
// must always carry an explicit --effort flag. Omission hands the choice to
// the harness default — xhigh on Opus 5 — violating the
// effort-defaults-to-high policy.

vi.mock('../../model-validation.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireModelOverrideSync: vi.fn((model: string) => model),
  shellQuoteModelIdSync: vi.fn((model: string) => model),
}));

vi.mock('../../providers.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getProviderForModelSync: vi.fn(() => ({ name: 'anthropic' })),
}));

vi.mock('../../claude-permissions.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getClaudePermissionFlagsStringSync: vi.fn(() => '--permission-mode default'),
}));

import { getRoleRuntimeBaseCommand } from '../runtime-command.js';

describe('getRoleRuntimeBaseCommand --effort (PAN-3077)', () => {
  beforeEach(() => {
    delete process.env.OVERDECK_TEST_HARNESS_COMMAND;
  });

  it('defaults to --effort high for the standing supervisor (review sub-role, no definition file)', async () => {
    const command = await getRoleRuntimeBaseCommand(
      'claude-opus-5',
      'agent-pan-3076-review-supervisor',
      'review',
      'claude-code',
      'supervisor',
    );

    expect(command).toContain(' --effort high');
    expect(command.match(/--effort/g)).toHaveLength(1);
  });

  it('keeps an explicitly passed effort for definition-less runs', async () => {
    const command = await getRoleRuntimeBaseCommand(
      'claude-opus-5',
      'agent-pan-3076-review-security',
      'review',
      'claude-code',
      'security',
      'xhigh',
    );

    expect(command).toContain(' --effort xhigh');
    expect(command).not.toContain('--effort high');
  });
});
