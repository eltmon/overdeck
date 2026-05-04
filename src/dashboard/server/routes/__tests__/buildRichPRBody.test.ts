/**
 * Tests for buildRichPRBody — rich PR description generator (PAN-475)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRichPRBody } from '../workspaces.js';

vi.mock('../../../../lib/beads-query.js', () => ({
  queryBeadsForIssue: vi.fn().mockResolvedValue([]),
}));

import { queryBeadsForIssue } from '../../../../lib/beads-query.js';

describe('buildRichPRBody', () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), 'pan-test-workspace-'));
    vi.mocked(queryBeadsForIssue).mockReset().mockResolvedValue([]);
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it('includes closes reference from issue number even with no plan', async () => {
    const body = await buildRichPRBody('PAN-42', workspacePath);
    expect(body).toContain('Closes #42');
  });

  it('includes closes reference for a different issue number', async () => {
    const body = await buildRichPRBody('PAN-123', workspacePath);
    expect(body).toContain('Closes #123');
  });

  it('omits AC section when no plan exists', async () => {
    const body = await buildRichPRBody('PAN-42', workspacePath);
    expect(body).not.toContain('## Acceptance Criteria');
  });

  it('includes AC checklist from vBRIEF plan items', async () => {
    await mkdir(join(workspacePath, '.planning'), { recursive: true });
    const plan = {
      vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
      plan: {
        id: 'test-plan',
        title: 'Test',
        status: 'in_progress',
        items: [
          { id: 'item-1', title: 'Do the thing', status: 'completed' },
          { id: 'item-2', title: 'Do another thing', status: 'pending' },
        ],
        edges: [],
      },
    };
    await writeFile(join(workspacePath, '.planning', 'plan.vbrief.json'), JSON.stringify(plan));

    const body = await buildRichPRBody('PAN-42', workspacePath);
    expect(body).toContain('## Acceptance Criteria');
    expect(body).toContain('- [x] Do the thing');
    expect(body).toContain('- [ ] Do another thing');
  });

  it('includes beads task summary from bd query', async () => {
    const beads = [
      { id: 'bead-1', title: 'pan-42: Fix the bug', status: 'closed', labels: ['pan-42'] },
      { id: 'bead-2', title: 'pan-42: Add the feature', status: 'open', labels: ['pan-42'] },
    ];
    vi.mocked(queryBeadsForIssue).mockResolvedValue(beads);

    const body = await buildRichPRBody('PAN-42', workspacePath);
    expect(body).toContain('## Implementation Tasks');
    expect(body).toContain('- [x] Fix the bug');
    expect(body).toContain('- [ ] Add the feature');
  });

  it('includes both AC checklist and beads when both exist', async () => {
    await mkdir(join(workspacePath, '.planning'), { recursive: true });

    const plan = {
      vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
      plan: {
        id: 'p', title: 'T', status: 'in_progress',
        items: [{ id: 'i1', title: 'AC One', status: 'completed' }],
        edges: [],
      },
    };
    await writeFile(join(workspacePath, '.planning', 'plan.vbrief.json'), JSON.stringify(plan));

    const bead = { id: 'b1', title: 'pan-5: Task one', status: 'closed', labels: ['pan-5'] };
    vi.mocked(queryBeadsForIssue).mockResolvedValue([bead]);

    const body = await buildRichPRBody('PAN-5', workspacePath);
    expect(body).toContain('## Acceptance Criteria');
    expect(body).toContain('- [x] AC One');
    expect(body).toContain('## Implementation Tasks');
    expect(body).toContain('- [x] Task one');
  });

  it('handles malformed plan JSON gracefully (omits AC section, keeps issue ref)', async () => {
    await mkdir(join(workspacePath, '.planning'), { recursive: true });
    await writeFile(join(workspacePath, '.planning', 'plan.vbrief.json'), '{invalid json}');

    const body = await buildRichPRBody('PAN-42', workspacePath);
    expect(body).toContain('Closes #42');
    expect(body).not.toContain('## Acceptance Criteria');
  });
});
