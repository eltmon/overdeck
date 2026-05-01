import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readBeadsTasks } from '../work-agent-prompt.js';

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
  it('filters beads by issue label, excluding other issues', async () => {
    writeBeadsJsonl(PROJECT_ROOT, [
      { id: 'pan-001', title: 'PAN-412: Implement feature A', labels: ['pan-412', 'difficulty:simple'] },
      { id: 'pan-002', title: 'PAN-412: Implement feature B', labels: ['pan-412', 'difficulty:medium'] },
      { id: 'pan-003', title: 'PAN-158: Unrelated task', labels: ['pan-158', 'difficulty:simple'] },
      { id: 'pan-004', title: 'PAN-164: Another unrelated', labels: ['pan-164', 'difficulty:medium'] },
      { id: 'pan-005', title: 'PAN-414: Yet another', labels: ['pan-414', 'difficulty:complex'] },
    ]);

    const tasks = await readBeadsTasks(WORKSPACE_DIR, PROJECT_ROOT, 'PAN-412');

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toContain('PAN-412: Implement feature A');
    expect(tasks[1]).toContain('PAN-412: Implement feature B');
  });

  it('matches beads using labels field (not just tags)', async () => {
    writeBeadsJsonl(PROJECT_ROOT, [
      { id: 'pan-010', title: 'Some generic title', labels: ['pan-419'] },
      { id: 'pan-011', title: 'Another generic title', labels: ['pan-420'] },
    ]);

    const tasks = await readBeadsTasks(WORKSPACE_DIR, PROJECT_ROOT, 'PAN-419');

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toContain('Some generic title');
  });

  it('handles legacy workspace: prefixed labels', async () => {
    writeBeadsJsonl(PROJECT_ROOT, [
      { id: 'pan-020', title: 'PAN-412: Implementation', labels: ['workspace:pan-412'] },
      { id: 'pan-021', title: 'PAN-412: Feature', labels: ['pan-412'] },
      { id: 'pan-022', title: 'PAN-158: Other', labels: ['workspace:pan-158'] },
    ]);

    const tasks = await readBeadsTasks(WORKSPACE_DIR, PROJECT_ROOT, 'PAN-412');

    // Should match both workspace: prefixed and bare labels containing pan-412
    expect(tasks).toHaveLength(2);
    expect(tasks.some(t => t.includes('Implementation'))).toBe(true);
    expect(tasks.some(t => t.includes('Feature'))).toBe(true);
  });

  it('deduplicates beads found in both workspace and project root', async () => {
    // Same bead in both locations
    writeBeadsJsonl(PROJECT_ROOT, [
      { id: 'pan-030', title: 'PAN-412: Shared bead', labels: ['pan-412'] },
    ]);
    mkdirSync(join(WORKSPACE_DIR, '.beads'), { recursive: true });
    writeBeadsJsonl(WORKSPACE_DIR, [
      { id: 'pan-030', title: 'PAN-412: Shared bead', labels: ['pan-412'] },
    ]);

    const tasks = await readBeadsTasks(WORKSPACE_DIR, PROJECT_ROOT, 'PAN-412');

    expect(tasks).toHaveLength(1);
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
