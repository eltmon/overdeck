import { existsSync } from 'node:fs';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  extractAcceptanceCriteriaFromIssue,
  synthesizeMinimalXBrief,
  writeAutoStartXBrief,
} from '../auto-synthesize.js';
import { findPlanSync } from '../io.js';
import type { ProjectConfig } from '../../projects.js';

const projectRegistry = vi.hoisted(() => ({
  entries: [] as Array<{ key: string; config: ProjectConfig }>,
}));

vi.mock('../../projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../projects.js')>();
  return {
    ...actual,
    findProjectByPath: (workspacePath: string) => projectRegistry.entries.find(({ config }) => (
      workspacePath === config.path || workspacePath.startsWith(`${config.path}/`)
    ))?.config ?? actual.findProjectByPath(workspacePath),
    listProjectsSync: () => projectRegistry.entries.length > 0
      ? projectRegistry.entries
      : actual.listProjectsSync(),
  };
});

beforeEach(() => {
  projectRegistry.entries = [];
});

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
\`pan start PAN-2386 --auto\` synthesized the minimal xBRIEF by scraping the issue body's bullet lists into acceptance criteria.

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

describe('synthesizeMinimalXBrief', () => {
  it('creates a proposed no-inspection v0.8 xBRIEF with acceptance-criterion items', () => {
    const doc = synthesizeMinimalXBrief({
      issueId: 'pan-1071',
      title: 'Auto start work agents',
      body: '## Acceptance Criteria\n- [ ] Synthesizes a minimal xBRIEF\n- [ ] Starts the normal flow',
      url: 'https://example.test/PAN-1071',
    });

    expect(doc.xBRIEFInfo.version).toBe('0.8');
    expect(doc.xBRIEFInfo.inspectionPolicy).toBe('never');
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
      'Synthesizes a minimal xBRIEF',
      'Starts the normal flow',
    ]);
    expect(doc.plan.items[0].subItems).toBeUndefined();
  });
});

describe('writeAutoStartXBrief', () => {
  it('writes the spec into the workspace plan home, never the primary checkout', async () => {
    await withTempDir(async (root) => {
      const projectRoot = join(root, 'project');
      const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-1071');
      await mkdir(workspacePath, { recursive: true });

      const result = await Effect.runPromise(writeAutoStartXBrief(workspacePath, {
        issueId: 'PAN-1071',
        title: 'Auto start work agents',
        body: '- [ ] Start from an issue body',
      }));

      const doc = JSON.parse(await readFile(result.specPath, 'utf-8'));

      expect(result.canonicalFilename).toMatch(/PAN-1071/);
      expect(result.specPath).toBe(join(workspacePath, '.pan', 'specs', result.canonicalFilename));
      expect(doc.xBRIEFInfo.version).toBe('0.8');
      expect(doc.vBRIEFInfo).toBeUndefined();
      expect(doc.plan.status).toBe('proposed');
      expect(doc.plan.metadata.canonicalFilename).toBe(result.canonicalFilename);
      expect(existsSync(join(projectRoot, '.pan', 'specs'))).toBe(false);
    });
  });

  it('writes a registered project spec into <workspace>/.pan/specs where findPlanSync resolves it', async () => {
    await withTempDir(async (root) => {
      const previousOverdeckHome = process.env['OVERDECK_HOME'];
      process.env['OVERDECK_HOME'] = root;
      try {
        const projectRoot = join(root, 'project');
        const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-1072');
        projectRegistry.entries = [{
          key: 'registered-project',
          config: { name: 'Registered project', path: projectRoot },
        }];
        await mkdir(workspacePath, { recursive: true });

        const result = await Effect.runPromise(writeAutoStartXBrief(workspacePath, {
          issueId: 'PAN-1072',
          title: 'Auto start work agents',
          body: '- [ ] Start from a registered project',
        }));

        // PAN-5316: the workspace is the plan home — the primary checkout
        // never gets a .pan/specs directory from auto-start synthesis.
        expect(result.specPath).toBe(join(workspacePath, '.pan', 'specs', result.canonicalFilename));
        expect(findPlanSync(workspacePath)).toBe(result.specPath);
        expect(existsSync(join(projectRoot, '.pan', 'specs'))).toBe(false);
      } finally {
        if (previousOverdeckHome === undefined) delete process.env['OVERDECK_HOME'];
        else process.env['OVERDECK_HOME'] = previousOverdeckHome;
      }
    });
  });
});
