import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VBriefDocument, VBriefItem } from '../../vbrief/types.js';
import type { TierAssignmentConfig } from '../dispatch-tier.js';

vi.mock('../../config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config-yaml.js')>();
  return {
    ...actual,
    loadConfigSync: vi.fn(),
  };
});

vi.mock('../../vbrief/io.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vbrief/io.js')>();
  return {
    ...actual,
    readWorkspacePlanSync: vi.fn(),
  };
});

import type { TieredCalloutBody } from '../../../dashboard/server/routes/tiered-callouts.js';

const ORIGINAL_OVERDECK_HOME = process.env.OVERDECK_HOME;
let tempRoot: string;
let projectRoot: string;

const TIER_CONFIG: TierAssignmentConfig = {
  enabled: true,
  tiers: {
    cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['simple'] },
    frontier: { model: 'claude-opus-4-8', harness: 'claude-code', difficulties: ['expert'] },
  },
  difficultyToTier: {
    simple: 'cheap',
    expert: 'frontier',
  },
};

function tieredConfig(enabled: boolean): TierAssignmentConfig & {
  feed: { callouts: 'notify' };
  escalation: { enabled: false; retries_at_tier: 0; max_promotions: 0; flounder_budget_minutes: {} };
} {
  return {
    ...TIER_CONFIG,
    enabled,
    feed: { callouts: 'notify' },
    escalation: { enabled: false, retries_at_tier: 0, max_promotions: 0, flounder_budget_minutes: {} },
  };
}

function writeProjectConfig(): void {
  const overdeckHome = join(tempRoot, 'overdeck-home');
  mkdirSync(overdeckHome, { recursive: true });
  process.env.OVERDECK_HOME = overdeckHome;
  writeFileSync(
    join(overdeckHome, 'projects.yaml'),
    [
      'projects:',
      '  overdeck-test:',
      '    name: Overdeck Test',
      `    path: ${JSON.stringify(projectRoot)}`,
      '    issue_prefix: PAN',
      '',
    ].join('\n'),
    'utf-8',
  );
}

async function loadHarness() {
  const configModule = await import('../../config-yaml.js');
  const vbriefModule = await import('../../vbrief/io.js');
  const spawnPrep = await import('../spawn-prep.js');
  const callouts = await import('../../../dashboard/server/routes/tiered-callouts.js');
  const loadConfigSync = configModule.loadConfigSync;
  const readWorkspacePlanSync = vbriefModule.readWorkspacePlanSync;
  vi.mocked(loadConfigSync).mockReset();
  vi.mocked(readWorkspacePlanSync).mockReset();
  return {
    loadConfigSync,
    readWorkspacePlanSync,
    resolveSingleWorkTierSpawnParams: spawnPrep.resolveSingleWorkTierSpawnParams,
    resolveSlotTierSpawnParams: spawnPrep.resolveSlotTierSpawnParams,
    handleTieredCallout: callouts.handleTieredCallout,
  };
}

function workspacePath(issueId: string): string {
  const workspace = join(projectRoot, 'workspaces', `feature-${issueId.toLowerCase()}`);
  mkdirSync(join(workspace, '.pan', 'records'), { recursive: true });
  return workspace;
}

function writeRecordOverride(issueId: string, override: 'on' | 'off'): void {
  const workspace = workspacePath(issueId);
  writeFileSync(
    join(workspace, '.pan', 'records', `${issueId.toLowerCase()}.json`),
    JSON.stringify({
      issueId,
      schemaVersion: 2,
      tieredExecutionOverride: override,
      pipeline: {},
      closeOut: {},
    }),
    'utf-8',
  );
}

function planDoc(issueId: string, metadata: Record<string, unknown>): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.6', created: '2026-07-06T00:00:00.000Z' },
    plan: {
      id: issueId.toLowerCase(),
      title: 'Record override dispatch',
      status: 'running',
      metadata,
      items: [
        { id: 'bead-x', title: 'Bead X', status: 'pending', metadata: { difficulty: 'expert' } },
      ],
      edges: [],
    },
  };
}

const CALLOUT: TieredCalloutBody = {
  issueId: 'PAN-9203',
  sha: 'abcdef1234567890',
  beadId: 'bead-x',
  tierName: 'frontier',
  agentId: 'agent-pan-9203-frontier',
  claim: 'Needs corroboration.',
};

const ITEM: VBriefItem = {
  id: 'bead-x',
  title: 'Bead X',
  status: 'pending',
  metadata: { difficulty: 'expert' },
};

describe('tiered dispatch record overrides', () => {
  beforeAll(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'dispatch-record-override-'));
    projectRoot = join(tempRoot, 'project');
    mkdirSync(join(projectRoot, '.git'), { recursive: true });
  });

  beforeEach(() => {
    vi.resetModules();
    writeProjectConfig();
  });

  afterEach(() => {
    if (ORIGINAL_OVERDECK_HOME === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = ORIGINAL_OVERDECK_HOME;
  });

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('record override off disables both live spawn paths even when global and plan metadata are on', async () => {
    const {
      loadConfigSync,
      readWorkspacePlanSync,
      resolveSingleWorkTierSpawnParams,
      resolveSlotTierSpawnParams,
    } = await loadHarness();
    const issueId = 'PAN-9201';
    const workspace = workspacePath(issueId);
    writeRecordOverride(issueId, 'off');
    vi.mocked(loadConfigSync).mockReturnValue({
      config: { tieredExecution: tieredConfig(true) },
    } as unknown as ReturnType<typeof loadConfigSync>);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc(issueId, { tiered_execution: 'on' }));

    expect(resolveSlotTierSpawnParams(workspace, 'bead-x')).toEqual({});
    expect(resolveSingleWorkTierSpawnParams(workspace)).toEqual({});
  });

  it('record override on enables both live spawn paths even when global and plan metadata are off', async () => {
    const {
      loadConfigSync,
      readWorkspacePlanSync,
      resolveSingleWorkTierSpawnParams,
      resolveSlotTierSpawnParams,
    } = await loadHarness();
    const issueId = 'PAN-9202';
    const workspace = workspacePath(issueId);
    writeRecordOverride(issueId, 'on');
    vi.mocked(loadConfigSync).mockReturnValue({
      config: { tieredExecution: tieredConfig(false) },
    } as unknown as ReturnType<typeof loadConfigSync>);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc(issueId, { tiered_execution: 'off' }));

    const expected = {
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      tierName: 'frontier',
    };
    expect(resolveSlotTierSpawnParams(workspace, 'bead-x')).toEqual(expected);
    expect(resolveSingleWorkTierSpawnParams(workspace)).toEqual(expected);
  });

  it('callout enablement agrees with dispatch when the record override flips', async () => {
    const {
      loadConfigSync,
      readWorkspacePlanSync,
      handleTieredCallout,
    } = await loadHarness();
    const issueId = CALLOUT.issueId;
    workspacePath(issueId);
    vi.mocked(loadConfigSync).mockReturnValue({
      config: { tieredExecution: tieredConfig(true) },
    } as unknown as ReturnType<typeof loadConfigSync>);
    vi.mocked(readWorkspacePlanSync).mockReturnValue(planDoc(issueId, { tiered_execution: 'on' }));

    writeRecordOverride(issueId, 'off');
    await expect(handleTieredCallout(CALLOUT, {
      getWorkspacePath: () => workspacePath(issueId),
      getItem: () => ITEM,
      recordCallout: vi.fn(),
      surfaceCallout: vi.fn().mockResolvedValue(undefined),
    })).resolves.toMatchObject({ status: 404 });

    writeRecordOverride(issueId, 'on');
    await expect(handleTieredCallout(CALLOUT, {
      getWorkspacePath: () => workspacePath(issueId),
      getItem: () => ITEM,
      recordCallout: vi.fn(),
      surfaceCallout: vi.fn().mockResolvedValue(undefined),
    })).resolves.toMatchObject({ status: 200 });
  });
});
