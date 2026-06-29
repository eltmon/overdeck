import { Effect } from 'effect';
/**
 * Tests for buildRichPRBody — rich PR description generator (PAN-475)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRichPRBody } from '../workspaces/merge-ops.js';

vi.mock('../../../../lib/beads-query.js', () => ({
  queryBeadsForIssue: vi.fn(() => Effect.succeed({ beads: [] })),
}));

import { queryBeadsForIssue } from '../../../../lib/beads-query.js';

describe('buildRichPRBody', () => {
  let projectRoot: string;
  let workspacePath: string;

  beforeEach(async () => {
    projectRoot = join(tmpdir(), `pan-test-project-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    workspacePath = join(projectRoot, 'workspaces', 'feature-pan-42');
    mkdirSync(workspacePath, { recursive: true });
    vi.mocked(queryBeadsForIssue).mockReset().mockReturnValue(Effect.succeed({ beads: [] }));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  function writeMainSpec(issueId: string, plan: Record<string, unknown>): Promise<void> {
    const specsDir = join(projectRoot, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    const slug = String(plan.title || 'test').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const filename = `2026-01-01-${issueId}-${slug}.vbrief.json`;
    const specDoc = { ...plan, status: 'active' };
    return writeFile(join(specsDir, filename), JSON.stringify(specDoc));
  }

  it('includes a NON-closing issue reference (GitHub auto-close races the post-merge lifecycle)', async () => {
    const body = await buildRichPRBody('PAN-42', workspacePath);
    expect(body).toContain('**Issue:** #42');
    expect(body).not.toMatch(/closes #/i);
  });

  it('includes the issue reference for a different issue number', async () => {
    // Different issue ID → different workspace path
    const ws123 = join(projectRoot, 'workspaces', 'feature-pan-123');
    mkdirSync(ws123, { recursive: true });
    const body = await buildRichPRBody('PAN-123', ws123);
    expect(body).toContain('**Issue:** #123');
  });

  it('omits AC section when no plan exists', async () => {
    const body = await buildRichPRBody('PAN-42', workspacePath);
    expect(body).not.toContain('## Acceptance Criteria');
  });

  it('includes AC checklist from vBRIEF plan items', async () => {
    const plan = {
      vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
      plan: {
        id: 'PAN-42',
        title: 'Test',
        status: 'active',
        items: [
          { id: 'item-1', title: 'Do the thing', status: 'completed' },
          { id: 'item-2', title: 'Do another thing', status: 'pending' },
        ],
        edges: [],
      },
    };
    await writeMainSpec('PAN-42', plan);

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
    vi.mocked(queryBeadsForIssue).mockReturnValue(Effect.succeed({ beads }));

    const body = await buildRichPRBody('PAN-42', workspacePath);
    expect(body).toContain('## Implementation Tasks');
    expect(body).toContain('- [x] Fix the bug');
    expect(body).toContain('- [ ] Add the feature');
  });

  it('includes both AC checklist and beads when both exist', async () => {
    const plan = {
      vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
      plan: {
        id: 'PAN-42',
        title: 'Test',
        status: 'active',
        items: [{ id: 'i1', title: 'AC One', status: 'completed' }],
        edges: [],
      },
    };
    await writeMainSpec('PAN-42', plan);

    const bead = { id: 'b1', title: 'pan-42: Task one', status: 'closed', labels: ['pan-42'] };
    vi.mocked(queryBeadsForIssue).mockReturnValue(Effect.succeed({ beads: [bead] }));

    const body = await buildRichPRBody('PAN-42', workspacePath);
    expect(body).toContain('## Acceptance Criteria');
    expect(body).toContain('- [x] AC One');
    expect(body).toContain('## Implementation Tasks');
    expect(body).toContain('- [x] Task one');
  });

  it('handles malformed plan JSON gracefully (omits AC section, keeps issue ref)', async () => {
    // Write invalid JSON directly to specs dir with a valid filename
    const specsDir = join(projectRoot, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    await writeFile(join(specsDir, '2026-01-01-PAN-42-test.vbrief.json'), '{invalid json}');

    const body = await buildRichPRBody('PAN-42', workspacePath);
    expect(body).toContain('**Issue:** #42');
    expect(body).not.toContain('## Acceptance Criteria');
  });
});
