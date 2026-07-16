import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolvePipelineMembership, type IssueLensSignals } from '../../../src/lib/pipeline-membership.js';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const CONSUMERS = [
  { name: 'resource-discovery', file: 'src/dashboard/server/services/resource-discovery.ts', delegates: /getPipelineMembershipForProjects/, legacy: /filter\(\(issue\) => !isTerminalTrackerState/ },
  { name: 'frontend-pipeline-state', file: 'src/dashboard/frontend/src/components/Pipeline/PipelineView.tsx', delegates: /pipelineMembership\?\.inPipeline/, legacy: /stateType.*in_progress.*in_review/ },
  { name: 'pan-pending', file: 'src/cli/commands/pending.ts', delegates: /resolvePipelineMembership/, legacy: /const memberIds = new Set\(Object\.values\(allStatuses\)/ },
  { name: 'enumerate-in-flight', file: 'src/lib/reconstruct/enumerate-in-flight.ts', delegates: /resolvePipelineMembership/, legacy: /openIssueIds|FEATURE_DIR_RE/ },
  { name: 'flywheel', file: 'src/lib/cloister/flywheel.ts', delegates: /resolvePipelineMembership/, legacy: /workspacesDir.*feature-/ },
  { name: 'pipeline-status-skill', file: 'sync-sources/skills/pipeline-status/SKILL.md', delegates: /\/api\/pipeline\/membership/, legacy: /in_progress','in_review/ },
] as const;

function signals(overrides: Partial<IssueLensSignals>): IssueLensSignals {
  return {
    issueId: 'PAN-1966',
    issueOpen: true,
    hasOpenPr: false,
    hasMergedPr: false,
    hasConventionBranch: false,
    branchUnmerged: false,
    phaseLabel: null,
    hasVbriefSpec: false,
    explicitlyReady: false,
    ...overrides,
  };
}

describe('pipeline membership no-loss audit', () => {
  it('reads all six consumers and mechanically enforces delegation with no legacy predicate', async () => {
    expect(new Set(CONSUMERS.map((consumer) => consumer.name)).size).toBe(6);
    for (const consumer of CONSUMERS) {
      const source = await readFile(resolve(root, consumer.file), 'utf-8');
      expect(source, `${consumer.name} must delegate through membership`).toMatch(consumer.delegates);
      expect(source, `${consumer.name} must not restore legacy membership math`).not.toMatch(consumer.legacy);
    }
  });

  it('proves the lint guard rejects seeded violations', () => {
    const result = spawnSync('bash', ['scripts/lint-pipeline-membership.sh', '--self-test'], {
      cwd: root,
      encoding: 'utf-8',
    });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('caught seeded consumer and durable-boundary violations');
  });

  it.each([
    ['closed issue with open PR', signals({ issueOpen: false, hasOpenPr: true }), 'zombie_pr'],
    ['open issue with merged PR', signals({ hasMergedPr: true }), 'post_merge_limbo'],
    ['open issue with spec only', signals({ hasVbriefSpec: true }), 'planned_backlog'],
    [
      'squash-merged branch',
      signals({ hasMergedPr: true, hasConventionBranch: true, branchUnmerged: true }),
      'post_merge_limbo',
    ],
    [
      'closed issue with branch residue',
      signals({ issueOpen: false, hasConventionBranch: true, branchUnmerged: true }),
      'clean_terminal',
    ],
  ] as const)('classifies %s as %s', (_name, input, expectedBucket) => {
    expect(resolvePipelineMembership(input).bucket).toBe(expectedBucket);
  });
});
