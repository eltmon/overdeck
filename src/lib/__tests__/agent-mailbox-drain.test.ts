import { mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../projects.js', () => ({ resolveProjectFromIssueSync: vi.fn(() => null) }));

import {
  createMailboxItem,
  confirmWorkMailboxDelivery,
  confirmWorkMailboxDeliveryBestEffort,
  markMailboxItemAcknowledged,
  markMailboxItemDelivered,
  parseMailboxMarkdown,
  prepareWorkMailbox,
  renderMailboxItem,
} from '../cloister/agent-mailbox.js';

describe('work-agent mailbox drain', () => {
  it('prepends paths and instructions on spawn, then acknowledges the same item on resume', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'mailbox-drain-'));
    const feedbackDir = join(workspacePath, '.pan', 'feedback');
    await mkdir(feedbackDir, { recursive: true });
    const filePath = join(feedbackDir, '001-review-agent-changes-requested.md');
    await writeFile(filePath, renderMailboxItem(createMailboxItem({
      issueId: 'PAN-2255', role: 'work', source: 'review-agent',
      summary: 'Fix the blocking review finding', actionRequired: true,
      filePath, markdownBody: '# Review feedback', createdAt: '2026-07-16T12:00:00Z',
    })));

    const spawn = await prepareWorkMailbox('Begin planned work.', { issueId: 'PAN-2255', workspacePath });
    expect(spawn.message).toContain('Read every feedback file listed below before continuing');
    expect(spawn.message).toContain(filePath);
    expect(spawn.message).toContain('review-agent: Fix the blocking review finding');
    expect(parseMailboxMarkdown(await readFile(filePath, 'utf8')).metadata?.state).toBe('pending');
    await confirmWorkMailboxDelivery(spawn.items);
    expect(parseMailboxMarkdown(await readFile(filePath, 'utf8')).metadata?.state).toBe('delivered');

    const resume = await prepareWorkMailbox('Continue.', { issueId: 'PAN-2255', workspacePath });
    expect(resume.message.match(new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(parseMailboxMarkdown(await readFile(filePath, 'utf8')).metadata?.state).toBe('delivered');
    await confirmWorkMailboxDelivery(resume.items);
    expect(parseMailboxMarkdown(await readFile(filePath, 'utf8')).metadata?.state).toBe('acknowledged');
  });

  it('leaves pending mail unchanged when prepared delivery is not confirmed', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'mailbox-drain-failure-'));
    const feedbackDir = join(workspacePath, '.pan', 'feedback');
    await mkdir(feedbackDir, { recursive: true });
    const filePath = join(feedbackDir, '001-test-agent-failed.md');
    await writeFile(filePath, renderMailboxItem(createMailboxItem({
      issueId: 'PAN-2255', role: 'work', source: 'test-agent', summary: 'Fix tests',
      actionRequired: true, filePath, markdownBody: '# Test feedback',
    })));

    const prepared = await prepareWorkMailbox('Continue.', { issueId: 'PAN-2255', workspacePath });
    expect(prepared.items).toHaveLength(1);
    expect(parseMailboxMarkdown(await readFile(filePath, 'utf8')).metadata?.state).toBe('pending');
  });

  it('serializes concurrent transitions without regressing acknowledged state', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'mailbox-concurrent-'));
    const feedbackDir = join(workspacePath, '.pan', 'feedback');
    await mkdir(feedbackDir, { recursive: true });
    const filePath = join(feedbackDir, '001-review.md');
    await writeFile(filePath, renderMailboxItem(createMailboxItem({
      issueId: 'PAN-2255', role: 'work', source: 'review-agent', summary: 'Fix review',
      actionRequired: true, filePath, markdownBody: '# Review',
    })));
    const address = { issueId: 'PAN-2255', role: 'work' as const, filePath };

    await Promise.all([
      markMailboxItemDelivered(address),
      markMailboxItemAcknowledged(address),
      markMailboxItemDelivered(address),
    ]);

    expect(parseMailboxMarkdown(await readFile(filePath, 'utf8')).metadata?.state).toBe('acknowledged');
  });

  it('preserves successful spawn and resume transport when mailbox persistence fails', async () => {
    const confirm = vi.fn(async () => { throw new Error('workspace read-only'); });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pending = createMailboxItem({
      issueId: 'PAN-2255', role: 'work', source: 'review-agent', summary: 'Fix review',
      actionRequired: true, filePath: '/tmp/review.md', markdownBody: '# Review',
    });

    await expect(confirmWorkMailboxDeliveryBestEffort([pending], 'agent-pan-2255/PAN-2255', confirm)).resolves.toBeUndefined();

    expect(confirm).toHaveBeenCalledOnce();
    expect(pending.state).toBe('pending');
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('agent-pan-2255/PAN-2255'));
  });
});
