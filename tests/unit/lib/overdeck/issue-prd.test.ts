import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ projectPath: '' }));

vi.mock('../../../../src/lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/projects.js')>();
  return {
    ...actual,
    resolveProjectFromIssueSync: vi.fn(() => ({
      projectName: 'test-project',
      projectPath: state.projectPath,
    })),
  };
});

import { getIssuePrd } from '../../../../src/lib/overdeck/issue-reads.js';
import { readPrdContent } from '../../../../src/lib/prd-locations.js';

function readJson(response: { body: { toJSON(): unknown } }): Record<string, unknown> {
  const body = response.body.toJSON() as { body: string };
  return JSON.parse(body.body) as Record<string, unknown>;
}

beforeEach(async () => {
  state.projectPath = await mkdtemp(join(tmpdir(), 'overdeck-issue-prd-'));
});

afterEach(async () => {
  await rm(state.projectPath, { recursive: true, force: true });
});

describe('getIssuePrd', () => {
  it('returns an existing draft with its canonical location metadata', async () => {
    const draftPath = join(state.projectPath, '.pan', 'drafts', 'PAN-3231.md');
    await mkdir(join(state.projectPath, '.pan', 'drafts'), { recursive: true });
    await writeFile(draftPath, '# PAN-3231\n\nDraft content.\n');

    const response = await Effect.runPromise(getIssuePrd('PAN-3231'));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      hasPrd: true,
      content: '# PAN-3231\n\nDraft content.\n',
      path: draftPath,
      status: 'draft',
      format: 'pan-draft',
    });
  });

  it('returns 404 without substituting workspace continue state', async () => {
    const continuePath = join(state.projectPath, 'workspaces', 'feature-pan-3231', '.overdeck', 'continue.json');
    await mkdir(join(state.projectPath, 'workspaces', 'feature-pan-3231', '.overdeck'), { recursive: true });
    await writeFile(continuePath, JSON.stringify({ decisions: [{ summary: 'Not a PRD' }] }));

    const response = await Effect.runPromise(getIssuePrd('PAN-3231'));
    const body = await readJson(response);

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ hasPrd: false });
    expect(JSON.stringify(body)).not.toContain('Not a PRD');
  });
});

describe('readPrdContent', () => {
  it('prefers prd.md when a lifecycle location contains multiple Markdown files', async () => {
    const prdDir = join(state.projectPath, 'docs', 'prds', 'active', 'pan-3231');
    await mkdir(prdDir, { recursive: true });
    await writeFile(join(prdDir, 'notes.md'), 'Notes');
    await writeFile(join(prdDir, 'prd.md'), 'Canonical PRD');

    await expect(readPrdContent({ path: prdDir, format: 'subdir', status: 'active' }))
      .resolves.toBe('Canonical PRD');
  });
});
