import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chooseDispatchTier } from '../../src/lib/agents/dispatch-tier.js';
import { resolveRegisteredSlotSpawn } from '../../src/lib/agents/spawn-prep.js';
import { verifyAndMergeSlot } from '../../src/lib/agents/slot-merge.js';
import { reconcileSlotState, type ReconciledSlotAgent, type ReconciledSlotBranch } from '../../src/lib/agents/slot-reconcile.js';
import { lintPlanQuality } from '../../src/lib/vbrief/quality-lint.js';
import { analyzeSwarmReadiness } from '../../src/lib/vbrief/swarm-readiness.js';
import type { VBriefDocument, VBriefItem } from '../../src/lib/vbrief/types.js';

const ISSUE_ID = 'PAN-1762';
const FEATURE_WORKSPACE = '/repo/workspaces/feature-pan-1762';

function ac(id: string, title: string) {
  return {
    id,
    title,
    status: 'pending' as const,
    metadata: { kind: 'acceptance_criterion' },
  };
}

function item(id: string, filesScope: string[], verifyCommand: string, expectedOutput: string): VBriefItem {
  return {
    id,
    title: id,
    status: 'pending',
    narrative: { Action: `Implement ${id} as an independently verified tracer bullet slice` },
    metadata: {
      difficulty: 'medium',
      requiresInspection: false,
      files_scope: filesScope,
      files_scope_confidence: 'high',
      readiness: 'ready',
      verify_commands: [verifyCommand],
      expected_outputs: [expectedOutput],
    },
    items: [
      ac(`${id}.ac1`, `Given ${id} input then it returns the configured result`),
      ac(`${id}.ac2`, `The ${id} command rejects invalid configuration clearly`),
    ],
  };
}

function swarmablePlan(): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-06-30T00:00:00Z' },
    plan: {
      id: ISSUE_ID.toLowerCase(),
      title: 'Foreman swarm dogfood',
      status: 'proposed',
      items: [
        item('tier-table-config', ['src/config/tier-table.ts'], 'npm run test:tier-table', 'tier table test reports success'),
        item('scheduler-relevance-map', ['src/scheduler/relevance-map.ts'], 'npm run test:relevance-map', 'relevance map test reports success'),
      ],
      edges: [],
    },
  };
}

describe('foreman swarm dogfood', () => {
  it('dispatches a swarm-eligible wave through registered slots and verify-then-merge seams', async () => {
    const doc = swarmablePlan();

    expect(lintPlanQuality(doc).filter(issue => issue.severity === 'error')).toEqual([]);

    const readiness = analyzeSwarmReadiness(doc);
    expect(readiness.swarmEligible).toBe(true);
    expect(readiness.conflictGroups).toEqual([]);
    expect(readiness.waves[0]?.items.map(item => item.id)).toEqual([
      'tier-table-config',
      'scheduler-relevance-map',
    ]);
    expect(readiness.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'tier-table-config', slotEligible: true }),
      expect.objectContaining({ id: 'scheduler-relevance-map', slotEligible: true }),
    ]));

    const slotSpawns = doc.plan.items.map((planItem, index) => {
      expect(chooseDispatchTier(planItem)).toBe('registered-slot');
      return resolveRegisteredSlotSpawn(ISSUE_ID, FEATURE_WORKSPACE, {
        slotIndex: index + 1,
        slotItemId: planItem.id,
      });
    });

    expect(slotSpawns).toEqual([
      {
        agentId: 'agent-pan-1762-slot-1',
        branch: 'feature/pan-1762-slot-1',
        workspace: '/repo/workspaces/feature-pan-1762-slot-1',
        slotIndex: 1,
        slotItemId: 'tier-table-config',
      },
      {
        agentId: 'agent-pan-1762-slot-2',
        branch: 'feature/pan-1762-slot-2',
        workspace: '/repo/workspaces/feature-pan-1762-slot-2',
        slotIndex: 2,
        slotItemId: 'scheduler-relevance-map',
      },
    ]);

    const branches: ReconciledSlotBranch[] = slotSpawns.map(slot => ({
      slotIndex: slot!.slotIndex,
      branch: slot!.branch,
      merged: false,
    }));
    const agents: ReconciledSlotAgent[] = slotSpawns.map(slot => ({
      slotIndex: slot!.slotIndex,
      agentId: slot!.agentId,
      status: 'running',
    }));
    const discovered = await reconcileSlotState(ISSUE_ID, FEATURE_WORKSPACE, doc, {
      deps: {
        listBranches: async () => branches,
        listAgents: () => agents,
      },
    });

    expect(discovered.inFlight).toEqual([
      expect.objectContaining({ itemId: 'tier-table-config', slotIndex: 1, agentId: 'agent-pan-1762-slot-1' }),
      expect.objectContaining({ itemId: 'scheduler-relevance-map', slotIndex: 2, agentId: 'agent-pan-1762-slot-2' }),
    ]);

    const mergedBranches = new Set<string>();
    const commandCalls: Array<{ command: string; cwd: string }> = [];
    const run = async (command: string, cwd: string) => {
      commandCalls.push({ command, cwd });
      const mergeBranch = /^git merge --no-ff "([^"]+)"$/.exec(command)?.[1];
      if (mergeBranch) mergedBranches.add(mergeBranch);
      return { stdout: `ok: ${command}`, stderr: '' };
    };

    const mergeResults = [];
    for (const [index, planItem] of doc.plan.items.entries()) {
      mergeResults.push(await verifyAndMergeSlot(
        { issueId: ISSUE_ID, featureWorkspace: FEATURE_WORKSPACE },
        index + 1,
        planItem,
        { deps: { run } },
      ));
    }

    expect(mergeResults).toEqual([
      expect.objectContaining({ verified: true, merged: true, conflicts: false }),
      expect.objectContaining({ verified: true, merged: true, conflicts: false }),
    ]);
    expect(mergedBranches).toEqual(new Set(['feature/pan-1762-slot-1', 'feature/pan-1762-slot-2']));
    expect(commandCalls).toEqual([
      { command: 'npm run test:tier-table', cwd: '/repo/workspaces/feature-pan-1762-slot-1' },
      { command: 'git merge --no-ff "feature/pan-1762-slot-1"', cwd: FEATURE_WORKSPACE },
      { command: 'npm run test:relevance-map', cwd: '/repo/workspaces/feature-pan-1762-slot-2' },
      { command: 'git merge --no-ff "feature/pan-1762-slot-2"', cwd: FEATURE_WORKSPACE },
    ]);
    expect(new Set(slotSpawns.map(slot => slot!.slotItemId))).toEqual(new Set(doc.plan.items.map(planItem => planItem.id)));
  });

  it('keeps the dispatch path free of issue-id special cases', () => {
    const dispatchPath = [
      'src/lib/agents/dispatch-tier.ts',
      'src/lib/agents/spawn-prep.ts',
      'src/lib/agents/slot-reconcile.ts',
    ].map(path => readFileSync(path, 'utf-8')).join('\n');

    expect(dispatchPath).not.toMatch(/PAN-1791|pan-1791/);
  });
});
