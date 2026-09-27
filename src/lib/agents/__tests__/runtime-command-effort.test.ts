import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

// PAN-3077: definition-less role runs (review sub-roles, standing supervisor)
// must always carry an explicit --effort flag. Omission hands the choice to
// the harness default — xhigh on Opus 5 — violating the
// effort-defaults-to-high policy.

const mocks = vi.hoisted(() => ({
  roleConfig: {} as { sub?: Record<string, { effort?: string }> },
}));

vi.mock('../../model-validation.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireModelOverride: vi.fn((model: string) => model),
  shellQuoteModelId: vi.fn((model: string) => model),
}));

vi.mock('../../providers.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getProviderForModel: vi.fn(() => ({ name: 'anthropic' })),
}));

vi.mock('../../claude-permissions.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getClaudePermissionFlagsString: vi.fn(() => '--permission-mode default'),
}));

vi.mock('../../config-yaml.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadConfigSync: vi.fn(() => ({
    config: { roles: { review: mocks.roleConfig }, tieredExecution: { tiers: {} } },
  })),
}));

vi.mock('../../paths.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveOhmypiExtensionPath: vi.fn(() => '/fake/ohmypi-extension.js'),
}));

vi.mock('../../runtimes/ohmypi-fifo.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ohmypiFifoPaths: vi.fn(() => ({ agentDir: '/tmp/fake-agent-dir', readyPath: '/tmp/fake-agent-dir/ready.json', fifoPath: '/tmp/fake-agent-dir/rpc.in' })),
  createOhmypiFifo: vi.fn(() => Effect.succeed('/tmp/fake-agent-dir/rpc.in')),
}));

vi.mock('fs/promises', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  mkdir: vi.fn(async () => undefined),
}));

import { getOhmypiLauncherFields, getRoleRuntimeBaseCommand } from '../runtime-command.js';

describe('getRoleRuntimeBaseCommand --effort (PAN-3077)', () => {
  beforeEach(() => {
    delete process.env.OVERDECK_TEST_HARNESS_COMMAND;
    mocks.roleConfig = {};
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

  it('resolves --effort from roles.review.sub.security.effort when nothing more specific is set', async () => {
    mocks.roleConfig = { sub: { security: { effort: 'low' } } };

    const command = await getRoleRuntimeBaseCommand(
      'claude-opus-5',
      'agent-pan-4249-review-security',
      'review',
      'claude-code',
      'security',
    );

    expect(command).toContain(' --effort low');
  });
});

describe('getOhmypiLauncherFields --effort', () => {
  it('clamps an unsupported explicit level to the highest ohmypi supports', async () => {
    const fields = await getOhmypiLauncherFields('agent-pan-4249-ohmypi', 'claude-opus-5', 'max');
    expect(fields.piEffort).toBe('xhigh');
  });
});
