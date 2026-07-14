import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  extractAcceptanceCriteriaFromIssue,
  synthesizeMinimalVBrief,
  writeAutoStartVBrief,
} from '../auto-synthesize.js';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'pan-auto-synthesize-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('extractAcceptanceCriteriaFromIssue', () => {
  it('prefers acceptance-criteria checklist items', () => {
    const criteria = extractAcceptanceCriteriaFromIssue('Add auto start', `
## Context
Ignore this bullet:
- background only

## Acceptance Criteria
- [ ] Adds \`pan start --auto\`
- [x] Creates tasks
`);

    expect(criteria).toEqual(['Adds pan start --auto', 'Creates tasks']);
  });

  it('falls back to the issue title for thin issue bodies', () => {
    expect(extractAcceptanceCriteriaFromIssue('Start work automatically', '')).toEqual([
      'Implement Start work automatically',
    ]);
  });

  it('ignores narrative bullets and returns generic AC when no explicit Acceptance section', () => {
    const criteria = extractAcceptanceCriteriaFromIssue('Fix deacon crash', `
## Observed
\`pan start PAN-2386 --auto\` synthesized the minimal vBRIEF by scraping the issue body's bullet lists into acceptance criteria.

- \`~/.overdeck/agents/agent-min-857/lifecycle.log (refusal event, 2026-07-05T18:37:40Z)\`
- \`Workspace: /home/eltmon/Projects/myn/workspaces/feature-min-857 (scaffold repo on master, ...)\`
- \`[deacon] Error coordinating swarm MIN-857: Command failed: git branch --list ...\`

## Context
This is just background information.
- More context bullets
- That should be ignored
`);

    expect(criteria).toEqual(["Issue's stated fix implemented with tests"]);
  });

  it('returns generic AC when body has no Acceptance section and no bullets', () => {
    const criteria = extractAcceptanceCriteriaFromIssue('Fix performance', 'This is just plain text with no bullets or sections.');

    expect(criteria).toEqual(["Issue's stated fix implemented with tests"]);
  });

  it('extracts bullets from Acceptance section but ignores narrative bullets elsewhere', () => {
    const criteria = extractAcceptanceCriteriaFromIssue('Fix workflow', `
## Observed
- This bullet should be ignored
- As should this one

## Acceptance Criteria
- [ ] Fixes the workflow
- [ ] Adds unit tests

## Context
- More bullets to ignore
`);

    expect(criteria).toEqual(['Fixes the workflow', 'Adds unit tests']);
  });
});

describe('synthesizeMinimalVBrief', () => {
  it('creates a proposed no-inspection v0.8 xBRIEF with acceptance-criterion items', () => {
    const doc = synthesizeMinimalVBrief({
      issueId: 'pan-1071',
      title: 'Auto start work agents',
      body: '## Acceptance Criteria\n- [ ] Synthesizes a minimal vBRIEF\n- [ ] Starts the normal flow',
      url: 'https://example.test/PAN-1071',
    });

    expect(doc.vBRIEFInfo.version).toBe('0.8');
    expect(doc.vBRIEFInfo.inspectionPolicy).toBe('never');
    expect(doc.plan.id).toBe('pan-1071');
    expect(doc.plan.status).toBe('proposed');
    expect(doc.plan.references).toEqual([{ uri: 'https://example.test/PAN-1071', label: 'PAN-1071', type: 'issue' }]);
    expect(doc.plan.items).toHaveLength(1);
    expect(doc.plan.items[0].metadata).toMatchObject({
      requiresInspection: false,
      inspectionDepth: 'fast',
      issueLabel: 'pan-1071',
    });
    expect(doc.plan.items[0].items?.map((item) => item.title)).toEqual([
      'Synthesizes a minimal vBRIEF',
      'Starts the normal flow',
    ]);
    expect(doc.plan.items[0].subItems).toBeUndefined();
  });
});

describe('writeAutoStartVBrief', () => {
  it('writes workspace and canonical project specs', async () => {
    await withTempDir(async (root) => {
      const projectRoot = join(root, 'project');
      const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-1071');

      const result = await Effect.runPromise(writeAutoStartVBrief(projectRoot, workspacePath, {
        issueId: 'PAN-1071',
        title: 'Auto start work agents',
        body: '- [ ] Start from an issue body',
      }));

      const workspaceDoc = JSON.parse(await readFile(result.workspaceSpecPath, 'utf-8'));
      const projectDoc = JSON.parse(await readFile(result.projectSpecPath, 'utf-8'));

      expect(result.canonicalFilename).toMatch(/PAN-1071/);
      expect(workspaceDoc.xBRIEFInfo.version).toBe('0.8');
      expect(workspaceDoc.vBRIEFInfo).toBeUndefined();
      expect(workspaceDoc.plan.status).toBe('proposed');
      expect(projectDoc.xBRIEFInfo.version).toBe('0.8');
      expect(projectDoc.vBRIEFInfo).toBeUndefined();
      expect(projectDoc.plan.status).toBe('proposed');
      expect(projectDoc.plan.metadata.canonicalFilename).toBe(result.canonicalFilename);
    });
  });
});
