import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readBeadsTasks } from '../work-agent-prompt.js';

vi.mock('../../beads-query.js', () => ({
  queryBeadsForIssue: vi.fn().mockResolvedValue([]),
}));

import { queryBeadsForIssue } from '../../beads-query.js';

let TEST_DIR: string;
let WORKSPACE_DIR: string;
let PROJECT_ROOT: string;

beforeEach(() => {
  TEST_DIR = join(tmpdir(), `pan-419-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  WORKSPACE_DIR = join(TEST_DIR, 'workspaces', 'feature-pan-412');
  PROJECT_ROOT = TEST_DIR;
  mkdirSync(join(WORKSPACE_DIR, '.planning'), { recursive: true });
  mkdirSync(join(PROJECT_ROOT, '.beads'), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeBeadsJsonl(dir: string, beads: Array<{ id: string; title: string; labels?: string[]; status?: string }>) {
  const lines = beads.map(b => JSON.stringify({
    id: b.id,
    title: b.title,
    labels: b.labels || [],
    status: b.status || 'open',
  }));
  writeFileSync(join(dir, '.beads', 'issues.jsonl'), lines.join('\n') + '\n');
}

describe('readBeadsTasks label scoping', () => {
  beforeEach(() => {
    vi.mocked(queryBeadsForIssue).mockReset().mockResolvedValue([]);
  });

  it('formats beads returned by queryBeadsForIssue', async () => {
    vi.mocked(queryBeadsForIssue).mockResolvedValue([
      { id: 'pan-001', title: 'PAN-412: Implement feature A', status: 'open', labels: ['pan-412'] },
      { id: 'pan-002', title: 'PAN-412: Implement feature B', status: 'open', labels: ['pan-412'] },
    ]);

    const tasks = await readBeadsTasks(WORKSPACE_DIR, PROJECT_ROOT, 'PAN-412');

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toContain('PAN-412: Implement feature A');
    expect(tasks[1]).toContain('PAN-412: Implement feature B');
  });

  it('matches beads using labels field (not just tags)', async () => {
    vi.mocked(queryBeadsForIssue).mockResolvedValue([
      { id: 'pan-010', title: 'Some generic title', status: 'open', labels: ['pan-419'] },
    ]);

    const tasks = await readBeadsTasks(WORKSPACE_DIR, PROJECT_ROOT, 'PAN-419');

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toContain('Some generic title');
  });

  it('handles legacy workspace: prefixed labels', async () => {
    vi.mocked(queryBeadsForIssue).mockResolvedValue([
      { id: 'pan-020', title: 'PAN-412: Implementation', status: 'open', labels: ['workspace:pan-412'] },
      { id: 'pan-021', title: 'PAN-412: Feature', status: 'open', labels: ['pan-412'] },
    ]);

    const tasks = await readBeadsTasks(WORKSPACE_DIR, PROJECT_ROOT, 'PAN-412');

    expect(tasks).toHaveLength(2);
    expect(tasks.some(t => t.includes('Implementation'))).toBe(true);
    expect(tasks.some(t => t.includes('Feature'))).toBe(true);
  });

  it('returns empty array when no beads match', async () => {
    vi.mocked(queryBeadsForIssue).mockResolvedValue([]);

    const tasks = await readBeadsTasks(WORKSPACE_DIR, PROJECT_ROOT, 'PAN-412');

    expect(tasks).toHaveLength(0);
  });
});

describe('work.md template label scoping', () => {
  it('contains bd ready with label filter placeholder', () => {
    const templatePath = join(__dirname, '..', 'prompts', 'work.md');
    const template = readFileSync(templatePath, 'utf-8');

    // Both occurrences of bd ready should include label filter
    const bdReadyLines = template.split('\n').filter(l => l.includes('`bd ready'));
    expect(bdReadyLines.length).toBeGreaterThanOrEqual(2);

    for (const line of bdReadyLines) {
      expect(line).toContain('-l {{ISSUE_ID_LOWER}}');
    }
  });

  it('contains warning about shared database scoping', () => {
    const templatePath = join(__dirname, '..', 'prompts', 'work.md');
    const template = readFileSync(templatePath, 'utf-8');

    expect(template).toContain('shared database contains beads from ALL issues');
  });
});
