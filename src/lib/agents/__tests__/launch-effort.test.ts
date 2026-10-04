import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pickLaunchEffort } from '../launch-effort.js';
import { resolveStaffing } from '../staffing.js';
import { roleAgentDefinitionPath, roleSystemPromptInjection } from '../runtime-command.js';
import type { XBriefItem } from '../../xbrief/types.js';

const WORK_ROLES = { work: { model: 'claude-sonnet-5' } } as never;

function item(id: string, metadata: Record<string, unknown> = {}): Pick<XBriefItem, 'id' | 'title' | 'metadata'> {
  return { id, title: `${id} title`, metadata: metadata as XBriefItem['metadata'] };
}

function tieredConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    tiers: {
      cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'], effort: 'low' },
      frontier: { model: 'claude-opus-5-5', harness: 'claude-code', difficulties: ['expert'], effort: 'high' },
    },
    difficultyToTier: { trivial: 'cheap', simple: 'cheap', expert: 'frontier' },
    byKind: {},
    ...overrides,
  } as never;
}

describe('pickLaunchEffort', () => {
  it('ac3: an explicit caller effort wins over a staffed tier effort', () => {
    const picked = pickLaunchEffort(
      { effort: 'max', effortSource: 'explicit' },
      { effort: 'low', effortSource: 'tier' },
    );
    expect(picked).toEqual({ effort: 'max', effortSource: 'explicit' });
  });

  it('ac3: a caller effort with no source (the pre-tiering convention) wins, same as explicit', () => {
    const picked = pickLaunchEffort(
      { effort: 'max' },
      { effort: 'low', effortSource: 'tier' },
    );
    expect(picked).toEqual({ effort: 'max' });
  });

  it('ac3: an empty staffed value leaves the caller value unchanged', () => {
    const caller = { effort: 'medium' as const, effortSource: 'role' as const };
    expect(pickLaunchEffort(caller, {})).toEqual(caller);
    expect(pickLaunchEffort({}, {})).toEqual({});
  });

  it('a non-explicit caller default is overridden by the staffed tier effort', () => {
    const picked = pickLaunchEffort(
      { effort: 'high', effortSource: 'role' },
      { effort: 'low', effortSource: 'tier' },
    );
    expect(picked).toEqual({ effort: 'low', effortSource: 'tier' });
  });
});

describe('launch-effort end-to-end: staffing -> pickLaunchEffort -> roleSystemPromptInjection (PAN-4257 W3)', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'launch-effort-'));
    process.env['OVERDECK_HOME'] = home;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('ac1: a trivial-tier item staffed at effort low overrides a non-explicit caller default of high', () => {
    const staffing = resolveStaffing(item('task', { difficulty: 'trivial' }), {
      config: { roles: WORK_ROLES, tieredExecution: tieredConfig() } as never,
    });
    const picked = pickLaunchEffort({ effort: 'high', effortSource: 'role' }, staffing);
    expect(picked).toEqual({ effort: 'low', effortSource: 'tier' });

    const launchString = roleSystemPromptInjection(roleAgentDefinitionPath('work'), picked.effort);
    expect(launchString).toContain(' --effort low');
    expect(launchString).not.toContain(' --effort high');
  });

  it('ac2: an expert-tier item staffed at effort high reaches the launch string', () => {
    const staffing = resolveStaffing(item('task', { difficulty: 'expert' }), {
      config: { roles: WORK_ROLES, tieredExecution: tieredConfig() } as never,
    });
    const picked = pickLaunchEffort({ effort: 'low', effortSource: 'role' }, staffing);
    expect(picked).toEqual({ effort: 'high', effortSource: 'tier' });

    const launchString = roleSystemPromptInjection(roleAgentDefinitionPath('work'), picked.effort);
    expect(launchString).toContain(' --effort high');
  });
});
