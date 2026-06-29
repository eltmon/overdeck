import { describe, expect, it } from 'vitest';
import {
  assembleUatContextGitFields,
  assembleUatContextPlanFields,
  emptyUatContextGitFields,
} from '../workspaces/workspace-data.js';
import type { ChangedFile } from '../../../../lib/cloister/review-context.js';
import type { VBriefDocument } from '../../../../lib/vbrief/types.js';

function makeDoc(items: VBriefDocument['plan']['items']): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-06-09T00:00:00.000Z' },
    plan: {
      id: 'pan-1686',
      title: 'Show UAT context',
      status: 'running',
      narratives: { Proposal: 'Surface UAT context on Awaiting Merge cards.' },
      items,
      edges: [],
    },
  };
}

function changedFile(path: string, index: number): ChangedFile {
  return {
    path,
    status: index % 2 === 0 ? 'M' : 'A',
    additions: index + 1,
    deletions: index,
    riskScore: 5,
  };
}

describe('assembleUatContextPlanFields', () => {
  it('prefers tagged acceptance criteria and includes deliverables', () => {
    const doc = makeDoc([
      {
        id: 'backend-endpoint',
        title: 'Add backend endpoint',
        status: 'completed',
        narrative: { Action: 'Return acceptance criteria and changed files.' },
        subItems: [
          {
            id: 'backend-endpoint.ac1',
            title: 'Endpoint returns UAT checklist',
            status: 'completed',
            metadata: { kind: 'acceptance_criterion' },
          },
          {
            id: 'backend-endpoint.note',
            title: 'Implementation note, not checklist text',
            status: 'pending',
            metadata: { kind: 'note' },
          },
        ],
      },
    ]);

    const result = assembleUatContextPlanFields(doc);

    expect(result.acceptanceCriteria).toEqual([
      {
        id: 'backend-endpoint.ac1',
        title: 'Endpoint returns UAT checklist',
        status: 'completed',
        itemId: 'backend-endpoint',
        itemTitle: 'Add backend endpoint',
      },
    ]);
    expect(result.deliverables).toEqual([
      {
        id: 'backend-endpoint',
        title: 'Add backend endpoint',
        status: 'completed',
        action: 'Return acceptance criteria and changed files.',
      },
    ]);
    expect(result.proposal).toBe('Surface UAT context on Awaiting Merge cards.');
  });

  it('falls back to all subItems when an item has no tagged acceptance criteria', () => {
    const doc = makeDoc([
      {
        id: 'frontend-section',
        title: 'Render frontend section',
        status: 'pending',
        subItems: [
          {
            id: 'frontend-section.note1',
            title: 'Show fallback checklist text',
            status: 'pending',
            metadata: { kind: 'note' },
          },
          {
            id: 'frontend-section.note2',
            title: 'Show expected changes text',
            status: 'pending',
          },
        ],
      },
    ]);

    const result = assembleUatContextPlanFields(doc);

    expect(result.acceptanceCriteria.map((criterion) => criterion.id)).toEqual([
      'frontend-section.note1',
      'frontend-section.note2',
    ]);
  });

  it('returns empty plan fields when no vBRIEF document is available', () => {
    expect(assembleUatContextPlanFields(null)).toEqual({
      acceptanceCriteria: [],
      deliverables: [],
      proposal: null,
    });
  });
});

describe('assembleUatContextGitFields', () => {
  it('maps changed files and records truncation counts', () => {
    const files = Array.from({ length: 13 }, (_, index) => changedFile(`src/file-${index}.ts`, index));
    const diffStat = { stat: '13 files changed, 91 insertions(+), 78 deletions(-)', truncated: true };

    const result = assembleUatContextGitFields(files, diffStat);

    expect(result.changedFiles).toHaveLength(12);
    expect(result.changedFiles[0]).toEqual({
      path: 'src/file-0.ts',
      status: 'M',
      additions: 1,
      deletions: 0,
    });
    expect(result.changedFiles[11]?.path).toBe('src/file-11.ts');
    expect(result.changedFilesTotal).toBe(13);
    expect(result.changedFilesOmitted).toBe(1);
    expect(result.diffStat).toEqual(diffStat);
    expect(result.source).toEqual({ files: 'git' });
  });

  it('caps the diff stat string before returning git fields', () => {
    const longDiffStat = 'x'.repeat(4_001);

    const result = assembleUatContextGitFields([
      changedFile('src/routes.ts', 0),
    ], { stat: longDiffStat, truncated: false });

    expect(result.diffStat?.stat).toHaveLength(4_000);
    expect(result.diffStat?.truncated).toBe(true);
  });

  it('returns the empty fallback for unavailable git diff stats', () => {
    expect(assembleUatContextGitFields([
      changedFile('src/routes.ts', 0),
    ], { stat: 'Unable to compute diff stat', truncated: true })).toEqual(emptyUatContextGitFields());
  });
});
