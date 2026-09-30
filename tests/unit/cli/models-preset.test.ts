/**
 * PAN-4400 WI-5: `pan models preset` prints the same plan object the route
 * returns, applies with the plan's digest, and exits 1 on a blocked plan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  planPresetApply: vi.fn(),
  applyPreset: vi.fn(),
  undoLastPresetApply: vi.fn(),
  listPresetStatus: vi.fn(),
}));

vi.mock('../../../src/lib/model-presets/plan.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/model-presets/plan.js')>()),
  planPresetApply: mocks.planPresetApply,
}));

vi.mock('../../../src/lib/model-presets/apply.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/model-presets/apply.js')>()),
  applyPreset: mocks.applyPreset,
  undoLastPresetApply: mocks.undoLastPresetApply,
  listPresetStatus: mocks.listPresetStatus,
}));

const { createModelsCommand } = await import('../../../src/cli/commands/models.js');

const planFixture = {
  presetId: 'openai',
  version: 1,
  date: '2026-09-29',
  provider: 'openai',
  label: 'OpenAI defaults',
  pilot: false,
  evidence: { status: 'research', reportPath: '.pan/drafts/model-routing-2026-09.md', summary: 'Research-backed.' },
  rows: [
    { path: 'workhorses.mid', segments: ['workhorses', 'mid'], label: 'Workhorse: mid', group: 'workhorses', before: { absent: true }, after: 'gpt-6-sol', status: 'change' },
    { path: 'jev.model', segments: ['jev', 'model'], label: 'Jev model', group: 'background', before: { absent: true }, after: { absent: true }, status: 'skipped', reason: 'Third-party.' },
  ],
  notes: ['tiered execution has no tiers; nothing to set'],
  digest: 'digest-abc',
};

let output: string[];
let errors: string[];

async function runCli(...args: string[]): Promise<void> {
  const program = createModelsCommand();
  program.exitOverride();
  await program.parseAsync(['node', 'models', ...args]);
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  output = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => { output.push(parts.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => { errors.push(parts.join(' ')); });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('pan models preset', () => {
  it('apply --dry-run --json prints exactly the plan JSON and never applies', async () => {
    mocks.planPresetApply.mockResolvedValue(planFixture);
    await runCli('preset', 'apply', 'openai', '--dry-run', '--json');
    expect(output).toEqual([JSON.stringify(planFixture, null, 2)]);
    expect(mocks.applyPreset).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('apply --yes applies with the plan digest', async () => {
    mocks.planPresetApply.mockResolvedValue(planFixture);
    mocks.applyPreset.mockResolvedValue({ plan: planFixture, applied: [planFixture.rows[0]], skipped: [planFixture.rows[1]] });
    await runCli('preset', 'apply', 'openai', '--yes');
    expect(mocks.applyPreset).toHaveBeenCalledWith('openai', { expectedDigest: 'digest-abc' });
    expect(output.join('\n')).toContain('Applied OpenAI defaults: 1 settings changed, 1 not set. Undo with: pan models preset undo');
  });

  it('a blocked plan sets exit code 1 and prints the reason', async () => {
    mocks.planPresetApply.mockResolvedValue({ ...planFixture, blocked: { reason: 'OpenAI has no credentials. Sign in (codex login).' } });
    await runCli('preset', 'apply', 'openai', '--yes');
    expect(process.exitCode).toBe(1);
    expect(mocks.applyPreset).not.toHaveBeenCalled();
    expect([...output, ...errors].join('\n')).toContain('OpenAI has no credentials. Sign in (codex login).');
  });

  it('show prints the text diff with the not-set reasons', async () => {
    mocks.planPresetApply.mockResolvedValue(planFixture);
    await runCli('preset', 'show', 'openai');
    const text = output.join('\n');
    expect(text).toContain('OpenAI defaults v1 (2026-09-29)');
    expect(text).toContain('Workhorse: mid  (unset) → gpt-6-sol');
    expect(text).toContain('Jev model: Third-party.');
    expect(text).toContain('tiered execution has no tiers; nothing to set');
  });

  it('undo prints the restored paths', async () => {
    mocks.undoLastPresetApply.mockResolvedValue({ restored: ['workhorses.mid', 'roles.work.model'], leftAsIs: [{ path: 'roles.test.model', reason: 'changed since apply; left as is' }] });
    await runCli('preset', 'undo');
    const text = output.join('\n');
    expect(text).toContain('Restored 2 settings.');
    expect(text).toContain('  workhorses.mid');
    expect(text).toContain('  roles.work.model');
    expect(text).toContain('roles.test.model: changed since apply; left as is');
  });

  it('an unknown preset prints the error and exits 1', async () => {
    const { UnknownPresetError } = await import('../../../src/lib/model-presets/plan.js');
    mocks.planPresetApply.mockRejectedValue(new UnknownPresetError('nope'));
    await runCli('preset', 'show', 'nope');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain("Unknown model preset 'nope'");
  });
});
