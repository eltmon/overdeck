import { mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../projects.js', () => ({ resolveProjectFromIssueSync: vi.fn(() => null) }));

import {
  createMailboxItem,
  parseMailboxMarkdown,
  prependWorkMailbox,
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

    const spawnPrompt = await prependWorkMailbox('Begin planned work.', { issueId: 'PAN-2255', workspacePath });
    expect(spawnPrompt).toContain('Read every feedback file listed below before continuing');
    expect(spawnPrompt).toContain(filePath);
    expect(spawnPrompt).toContain('review-agent: Fix the blocking review finding');
    expect(parseMailboxMarkdown(await readFile(filePath, 'utf8')).metadata?.state).toBe('delivered');

    const resumePrompt = await prependWorkMailbox('Continue.', { issueId: 'PAN-2255', workspacePath });
    expect(resumePrompt.match(new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(parseMailboxMarkdown(await readFile(filePath, 'utf8')).metadata?.state).toBe('acknowledged');
  });
});
