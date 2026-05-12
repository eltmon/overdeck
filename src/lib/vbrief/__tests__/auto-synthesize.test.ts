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
- [x] Creates beads
`);

    expect(criteria).toEqual(['Adds pan start --auto', 'Creates beads']);
  });

  it('falls back to the issue title for thin issue bodies', () => {
    expect(extractAcceptanceCriteriaFromIssue('Start work automatically', '')).toEqual([
      'Implement Start work automatically',
    ]);
  });
});

describe('synthesizeMinimalVBrief', () => {
  it('creates a proposed no-inspection vBRIEF with acceptance-criterion subitems', () => {
    const doc = synthesizeMinimalVBrief({
      issueId: 'pan-1071',
      title: 'Auto start work agents',
      body: '## Acceptance Criteria\n- [ ] Synthesizes a minimal vBRIEF\n- [ ] Starts the normal flow',
      url: 'https://example.test/PAN-1071',
    });

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
    expect(doc.plan.items[0].subItems?.map((item) => item.title)).toEqual([
      'Synthesizes a minimal vBRIEF',
      'Starts the normal flow',
    ]);
  });
});

describe('writeAutoStartVBrief', () => {
  it('writes workspace and canonical project specs', async () => {
    await withTempDir(async (root) => {
      const projectRoot = join(root, 'project');
      const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-1071');

      const result = await writeAutoStartVBrief(projectRoot, workspacePath, {
        issueId: 'PAN-1071',
        title: 'Auto start work agents',
        body: '- [ ] Start from an issue body',
      });

      const workspaceDoc = JSON.parse(await readFile(result.workspaceSpecPath, 'utf-8'));
      const projectDoc = JSON.parse(await readFile(result.projectSpecPath, 'utf-8'));

      expect(result.canonicalFilename).toMatch(/PAN-1071/);
      expect(workspaceDoc.plan.status).toBe('proposed');
      expect(projectDoc.plan.status).toBe('proposed');
      expect(projectDoc.plan.metadata.canonicalFilename).toBe(result.canonicalFilename);
    });
  });
});
