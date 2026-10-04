import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

// PAN-3077: definition-less role runs (review sub-roles, standing supervisor)
// must always carry an explicit --effort flag. Omission hands the choice to
// the harness default — xhigh on Opus 5 — violating the
// effort-defaults-to-high policy.

const mocks = vi.hoisted(() => ({
  roleConfig: {} as { effort?: string; sub?: Record<string, { effort?: string }> },
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

const initCodexHomeMock = vi.hoisted(() => vi.fn());
vi.mock('../../runtimes/codex.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  initCodexHome: initCodexHomeMock,
}));

vi.mock('../../acp/context.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  materializeAcpContextFile: vi.fn(() => '/tmp/fake-agent-dir/acp-context.json'),
}));

import { EFFORT_LEVELS } from '@overdeck/contracts';
import {
  getAcpLauncherFields,
  getCodexLauncherFields,
  getKimiCodeLauncherFields,
  getOhmypiLauncherFields,
  getRoleRuntimeBaseCommand,
} from '../runtime-command.js';

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

describe('getCodexLauncherFields --effort (PAN-4260 F2)', () => {
  beforeEach(() => {
    initCodexHomeMock.mockClear();
    mocks.roleConfig = {};
  });

  it('resolves once and passes the same value to initCodexHome and codexEffort', () => {
    mocks.roleConfig = { effort: 'low' };

    const fields = getCodexLauncherFields('agent-x', 'gpt-5.6-sol', '/tmp/ws', 'review');

    expect(fields.codexEffort).toBe('low');
    expect(initCodexHomeMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ effort: 'low' }),
    );
  });
});

describe('getRoleRuntimeBaseCommand --effort mapping tables (PAN-4260 FR-6)', () => {
  beforeEach(() => {
    delete process.env.OVERDECK_TEST_HARNESS_COMMAND;
    mocks.roleConfig = {};
  });

  // subRole 'security' has no roles/review-security.md definition file, so
  // getRoleRuntimeBaseCommand takes the definition-less branch and emits
  // `--effort ${resolveEffort(...).effort}` — the clamping branch under test.
  // (role='review' with subRole undefined resolves roles/review.md, which
  // exists, and routes through roleSystemPromptInjection instead, which does
  // not clamp — not what this table is meant to exercise.)
  it.each(EFFORT_LEVELS)('passes --effort %s through for claude-fable-5 (all levels supported)', async (level) => {
    const command = await getRoleRuntimeBaseCommand('claude-fable-5', 'n', 'review', 'claude-code', 'security', level);
    expect(command).toContain(` --effort ${level}`);
  });

  it('clamps xhigh to high for claude-sonnet-4-6 (no xhigh in its effortLevels)', async () => {
    const command = await getRoleRuntimeBaseCommand('claude-sonnet-4-6', 'n', 'review', 'claude-code', 'security', 'xhigh');
    expect(command).toContain(' --effort high');
    expect(command).not.toContain('--effort xhigh');
  });

  it.each(['low', 'medium', 'high', 'max'] as const)('leaves %s unchanged for claude-sonnet-4-6', async (level) => {
    const command = await getRoleRuntimeBaseCommand('claude-sonnet-4-6', 'n', 'review', 'claude-code', 'security', level);
    expect(command).toContain(` --effort ${level}`);
  });
});

describe('getKimiCodeLauncherFields --effort (PAN-4260)', () => {
  it('defaults to high when no effort is given', () => {
    const fields = getKimiCodeLauncherFields('kimi-code/k3');
    expect(fields.kimiCodeEffort).toBe('high');
  });
});

describe('getAcpLauncherFields --effort (PAN-4260)', () => {
  it('passes an OpenCode variant through unchanged', () => {
    const fields = getAcpLauncherFields('agent-x', 'opencode/some-model', '/tmp/ws', '/bin/acp-host', undefined, 'custom-variant');
    expect(fields.acpEffort).toBe('custom-variant');
  });

  it('defaults to high for a Kimi ACP model with no effort', () => {
    const fields = getAcpLauncherFields('agent-x', 'k3', '/tmp/ws', '/bin/acp-host');
    expect(fields.acpEffort).toBe('high');
  });
});
