import { mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  getReviewStatusSync: vi.fn(),
}));

vi.mock('../../projects.js', () => ({ resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync }));
import {
  createMailboxItem,
  getMailboxCacheSizesForTests,
  listMailboxItems,
  markMailboxItemAcknowledged,
  markMailboxItemDelivered,
  parseMailboxMarkdown,
  renderMailboxItem,
  resetMailboxCachesForTests,
} from '../agent-mailbox.js';
import { registerMailboxStatusReader } from '../mailbox-status-source.js';

describe('agent mailbox', () => {
  let workspacePath: string;
  let feedbackDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    registerMailboxStatusReader(issueId => mocks.getReviewStatusSync(issueId));
    resetMailboxCachesForTests();
    workspacePath = await mkdtemp(join(tmpdir(), 'agent-mailbox-'));
    feedbackDir = join(workspacePath, '.pan', 'feedback');
    await mkdir(feedbackDir, { recursive: true });
  });

  afterEach(() => vi.restoreAllMocks());

  it('creates and lists parseable issue-role metadata without an agent id', async () => {
    const filePath = join(feedbackDir, '001-review-agent-changes-requested.md');
    const item = createMailboxItem({
      issueId: 'PAN-2255', role: 'work', source: 'review-agent', summary: 'Fix the finding',
      actionRequired: true, filePath, markdownBody: '# Review feedback\n\nReadable details.',
      createdAt: '2026-07-16T12:00:00Z',
    });
    await writeFile(filePath, renderMailboxItem(item));

    const listed = await listMailboxItems({ issueId: 'PAN-2255', role: 'work', workspacePath });
    expect(listed).toEqual([expect.objectContaining({
      issueId: 'PAN-2255', role: 'work', state: 'pending', filePath, legacy: false,
    })]);
    expect(await readFile(filePath, 'utf8')).toContain('# Review feedback\n\nReadable details.');
  });

  it('uses the discovered path after a workspace is relocated', async () => {
    const filePath = join(feedbackDir, '001-review-agent-changes-requested.md');
    const stalePath = '/old/workspace/.pan/feedback/001-review-agent-changes-requested.md';
    const item = createMailboxItem({
      issueId: 'PAN-2255', role: 'work', source: 'review-agent', summary: 'Fix the finding',
      actionRequired: true, filePath: stalePath, markdownBody: '# Review feedback',
      createdAt: '2026-07-16T12:00:00Z',
    });
    await writeFile(filePath, renderMailboxItem(item));

    const listed = await listMailboxItems({ issueId: 'PAN-2255', role: 'work', workspacePath });
    expect(listed[0].filePath).toBe(filePath);
    await markMailboxItemDelivered({ issueId: 'PAN-2255', role: 'work', filePath: listed[0].filePath });
    expect(parseMailboxMarkdown(await readFile(filePath, 'utf8')).metadata?.state).toBe('delivered');
  });

  it('returns legacy numbered feedback only while its pipeline status requires action', async () => {
    const filePath = join(feedbackDir, '001-review-agent-changes-requested.md');
    await writeFile(filePath, '# Review blocked\n\nFix this.');
    mocks.getReviewStatusSync.mockReturnValue({ reviewStatus: 'blocked', testStatus: 'pending' });

    await expect(listMailboxItems({ issueId: 'PAN-2255', role: 'work', workspacePath })).resolves.toEqual([
      expect.objectContaining({ source: 'review-agent', state: 'pending', actionRequired: true, legacy: true, filePath }),
    ]);

    mocks.getReviewStatusSync.mockReturnValue({ reviewStatus: 'passed', testStatus: 'passed' });
    await expect(listMailboxItems({ issueId: 'PAN-2255', role: 'work', workspacePath })).resolves.toEqual([]);
  });

  it('marks delivered and acknowledged idempotently while preserving markdown', async () => {
    const filePath = join(feedbackDir, '001-test-agent-failed.md');
    const original = createMailboxItem({
      issueId: 'PAN-2255', role: 'work', source: 'test-agent', summary: 'Tests failed',
      actionRequired: true, filePath, markdownBody: '# Tests failed\n\nKeep this readable.',
      createdAt: '2026-07-16T12:00:00Z',
    });
    await writeFile(filePath, renderMailboxItem(original));
    const address = { issueId: 'PAN-2255', role: 'work' as const, workspacePath, filePath };

    await markMailboxItemDelivered({ ...address, at: '2026-07-16T12:01:00Z' });
    await markMailboxItemDelivered({ ...address, at: '2026-07-16T12:02:00Z' });
    await markMailboxItemAcknowledged({ ...address, at: '2026-07-16T12:03:00Z' });
    await markMailboxItemAcknowledged({ ...address, at: '2026-07-16T12:04:00Z' });

    const content = await readFile(filePath, 'utf8');
    const parsed = parseMailboxMarkdown(content);
    expect(parsed.metadata).toMatchObject({
      state: 'acknowledged', deliveredAt: '2026-07-16T12:01:00Z', acknowledgedAt: '2026-07-16T12:03:00Z',
    });
    expect(parsed.markdownBody).toContain('# Tests failed\n\nKeep this readable.');
  });

  it('bounds cache retention independently of retired workspace rescans', async () => {
    for (let index = 0; index < 520; index += 1) {
      const filePath = join(feedbackDir, `${String(index).padStart(3, '0')}-review-agent-changes-requested.md`);
      await writeFile(filePath, '# Review blocked');
    }
    mocks.getReviewStatusSync.mockReturnValue({ reviewStatus: 'blocked' });

    await listMailboxItems({ issueId: 'PAN-2255', role: 'work', workspacePath });

    expect(getMailboxCacheSizesForTests()).toEqual({ files: 512, directories: 1 });
  });
});
