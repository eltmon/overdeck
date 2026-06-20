import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Issue } from '../../tracker/interface.js';

vi.mock('../../review-status.js', () => ({
  getReviewStatusSync: vi.fn().mockReturnValue(null),
}));

import { collectOpenBacklog } from '../backlog-input.js';
import { getReviewStatusSync } from '../../review-status.js';

const BASE_ISSUE: Issue = {
  id: '1',
  ref: 'PAN-1',
  title: 'Issue One',
  description: 'Body of issue one.',
  state: 'open',
  labels: ['priority:high'],
  url: 'https://github.com/test/repo/issues/1',
  tracker: 'github',
  createdAt: new Date(Date.now() - 86400000).toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeIssue(overrides: Partial<Issue>): Issue {
  return { ...BASE_ISSUE, ...overrides };
}

describe('collectOpenBacklog', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'backlog-input-test-'));
    vi.mocked(getReviewStatusSync).mockReturnValue(null);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('returns one entry per open issue', async () => {
    const issues = [makeIssue({ ref: 'PAN-1' }), makeIssue({ id: '2', ref: 'PAN-2' })];
    const result = await collectOpenBacklog(tmpDir, issues);
    expect(result.manifest).toHaveLength(2);
  });

  it('excludes closed issues', async () => {
    const issues = [
      makeIssue({ ref: 'PAN-1', state: 'open' }),
      makeIssue({ id: '2', ref: 'PAN-2', state: 'closed' }),
      makeIssue({ id: '3', ref: 'PAN-3', state: 'cancelled' }),
    ];
    const result = await collectOpenBacklog(tmpDir, issues);
    expect(result.manifest).toHaveLength(1);
    expect(result.manifest[0].id).toBe('PAN-1');
  });

  it('sets inPipeline=false when review_status is null', async () => {
    vi.mocked(getReviewStatusSync).mockReturnValue(null);
    const result = await collectOpenBacklog(tmpDir, [makeIssue({ ref: 'PAN-1' })]);
    expect(result.manifest[0].inPipeline).toBe(false);
  });

  it('sets inPipeline=true when review_status is non-pending', async () => {
    vi.mocked(getReviewStatusSync).mockReturnValue({
      issueId: 'PAN-1', reviewStatus: 'reviewing', testStatus: 'pending',
      readyForMerge: false, updatedAt: new Date().toISOString(),
    } as any);
    const result = await collectOpenBacklog(tmpDir, [makeIssue({ ref: 'PAN-1' })]);
    expect(result.manifest[0].inPipeline).toBe(true);
  });

  it('sets inPipeline=true when workspace dir exists (no review status needed)', async () => {
    vi.mocked(getReviewStatusSync).mockReturnValue(null);
    mkdirSync(join(tmpDir, 'workspaces', 'feature-pan-1'), { recursive: true });
    const result = await collectOpenBacklog(tmpDir, [makeIssue({ ref: 'PAN-1' })]);
    expect(result.manifest[0].inPipeline).toBe(true);
  });

  it('sets hasPrd from injected hasPrdFn', async () => {
    const result = await collectOpenBacklog(tmpDir, [makeIssue({ ref: 'PAN-1' })], {
      hasPrdFn: (id) => id === 'PAN-1',
    });
    expect(result.manifest[0].hasPrd).toBe(true);
  });

  it('sets ready from injected hasSpecFn', async () => {
    const result = await collectOpenBacklog(tmpDir, [makeIssue({ ref: 'PAN-1' })], {
      hasSpecFn: (id) => id === 'PAN-1',
    });
    expect(result.manifest[0].ready).toBe(true);
  });

  it('ready=false when specs dir does not exist', async () => {
    const result = await collectOpenBacklog(tmpDir, [makeIssue({ ref: 'PAN-1' })]);
    expect(result.manifest[0].ready).toBe(false);
  });

  it('ready=false when specs dir exists but no spec for this issue', async () => {
    const specsDir = join(tmpDir, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, '2026-01-01-PAN-99-some-other.vbrief.json'), '{}');
    const result = await collectOpenBacklog(tmpDir, [makeIssue({ ref: 'PAN-1' })]);
    expect(result.manifest[0].ready).toBe(false);
  });

  it('ready=false when spec exists but workspace beads are missing', async () => {
    const specsDir = join(tmpDir, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, '2026-01-01-PAN-1-my-feature.vbrief.json'), '{}');
    const result = await collectOpenBacklog(tmpDir, [makeIssue({ ref: 'PAN-1' })]);
    expect(result.manifest[0].ready).toBe(false);
  });

  it('ready=true when spec and workspace beads both exist', async () => {
    const specsDir = join(tmpDir, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, '2026-01-01-PAN-1-my-feature.vbrief.json'), '{}');
    const beadsDir = join(tmpDir, 'workspaces', 'feature-pan-1', '.beads');
    mkdirSync(beadsDir, { recursive: true });
    writeFileSync(join(beadsDir, 'issues.jsonl'), '');
    const result = await collectOpenBacklog(tmpDir, [makeIssue({ ref: 'PAN-1' })]);
    expect(result.manifest[0].ready).toBe(true);
  });

  it('includes updatedAt in each manifest entry', async () => {
    const updatedAt = '2026-06-20T10:00:00.000Z';
    const result = await collectOpenBacklog(tmpDir, [makeIssue({ ref: 'PAN-1', updatedAt })]);
    expect(result.manifest[0].updatedAt).toBe(updatedAt);
  });

  it('returns a batched body accessor (not a single concatenation)', async () => {
    const issues = Array.from({ length: 10 }, (_, i) =>
      makeIssue({ id: String(i), ref: `PAN-${i + 1}`, description: `Body ${i + 1}` })
    );
    const result = await collectOpenBacklog(tmpDir, issues);
    const batch = result.bodies.getBatch(0, 5);
    expect(batch).toHaveLength(5);
    expect(batch[0].id).toBe('PAN-1');
    const batch2 = result.bodies.getBatch(1, 5);
    expect(batch2).toHaveLength(5);
    expect(batch2[0].id).toBe('PAN-6');
  });

  it('loads prior sequence.md when present', async () => {
    const doc = {
      version: '1', project: 'overdeck', generatedAt: new Date().toISOString(),
      model: 'claude-opus-4-8', pass: 'creation', openCount: 1,
      nodes: [{
        issue: 'PAN-1', rank: 1, size: 'S', importance: 'high', score: 80,
        condition: 'ok', dependsOn: [], why: 'Prior why.', gate: 'auto', planning: 'auto',
      }],
      edges: [],
    };
    const seqDir = join(tmpDir, '.pan', 'backlog');
    mkdirSync(seqDir, { recursive: true });
    const marker = '<!-- machine-readable; do not hand-edit below this line -->';
    writeFileSync(join(seqDir, 'sequence.md'), `# Seq\n\n${marker}\n\n\`\`\`json\n${JSON.stringify(doc)}\n\`\`\`\n`);
    const result = await collectOpenBacklog(tmpDir, [makeIssue({ ref: 'PAN-1' })]);
    expect(result.priorSequence).not.toBeNull();
    expect(result.priorSequence?.nodes[0].issue).toBe('PAN-1');
  });

  it('returns priorSequence=null when no sequence.md exists', async () => {
    const result = await collectOpenBacklog(tmpDir, [makeIssue({ ref: 'PAN-1' })]);
    expect(result.priorSequence).toBeNull();
  });
});
