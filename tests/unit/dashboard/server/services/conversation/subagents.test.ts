import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKGROUND_SUBAGENT_IDLE_MS,
  createTaskNotificationScanner,
  listSubagentMetas,
  listSubagentSummaries,
  subagentTranscriptPath,
  subagentsDirFor,
} from '../../../../../../src/dashboard/server/services/conversation/subagents.js';

let tempDir: string;
let sessionFile: string;

async function writeMeta(agentId: string, meta: unknown): Promise<void> {
  const subagentsDir = subagentsDirFor(sessionFile);
  await mkdir(subagentsDir, { recursive: true });
  await writeFile(join(subagentsDir, `agent-${agentId}.meta.json`), JSON.stringify(meta));
}

describe('conversation subagent discovery', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'overdeck-subagents-'));
    sessionFile = join(tempDir, 'session.jsonl');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('discovers subagent metadata with ids derived from filenames', async () => {
    await writeMeta('alpha', {
      agentType: 'Explore',
      description: 'Find the conversation parser',
      toolUseId: 'toolu_alpha',
      spawnDepth: 1,
    });
    await writeMeta('beta-2', {
      agentType: 'general-purpose',
      description: 'Trace the message stream',
      toolUseId: 'toolu_beta',
      spawnDepth: 2,
    });

    await expect(listSubagentMetas(sessionFile)).resolves.toEqual([
      {
        agentId: 'alpha',
        agentType: 'Explore',
        description: 'Find the conversation parser',
        toolUseId: 'toolu_alpha',
        spawnDepth: 1,
      },
      {
        agentId: 'beta-2',
        agentType: 'general-purpose',
        description: 'Trace the message stream',
        toolUseId: 'toolu_beta',
        spawnDepth: 2,
      },
    ]);
  });

  it('returns an empty list for absent and empty subagent directories', async () => {
    await expect(listSubagentMetas(sessionFile)).resolves.toEqual([]);

    await mkdir(subagentsDirFor(sessionFile), { recursive: true });
    await expect(listSubagentMetas(sessionFile)).resolves.toEqual([]);
  });

  it('warns and retries corrupt metadata while preserving valid entries', async () => {
    await writeMeta('valid', {
      agentType: 'Explore',
      description: 'Inspect valid metadata',
      toolUseId: 'toolu_valid',
      spawnDepth: 1,
    });
    await mkdir(subagentsDirFor(sessionFile), { recursive: true });
    await writeFile(join(subagentsDirFor(sessionFile), 'agent-corrupt.meta.json'), '{not json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(listSubagentMetas(sessionFile)).resolves.toEqual([
      {
        agentId: 'valid',
        agentType: 'Explore',
        description: 'Inspect valid metadata',
        toolUseId: 'toolu_valid',
        spawnDepth: 1,
      },
    ]);
    expect(warn).toHaveBeenCalledOnce();

    await writeMeta('corrupt', {
      agentType: 'general-purpose',
      description: 'Recover after a partial write',
      toolUseId: 'toolu_recovered',
      spawnDepth: 2,
    });
    await expect(listSubagentMetas(sessionFile)).resolves.toEqual([
      {
        agentId: 'corrupt',
        agentType: 'general-purpose',
        description: 'Recover after a partial write',
        toolUseId: 'toolu_recovered',
        spawnDepth: 2,
      },
      {
        agentId: 'valid',
        agentType: 'Explore',
        description: 'Inspect valid metadata',
        toolUseId: 'toolu_valid',
        spawnDepth: 1,
      },
    ]);
  });

  it('resolves valid transcript ids inside the subagents directory and rejects unsafe ids', () => {
    expect(subagentTranscriptPath(sessionFile, 'alpha_2')).toBe(
      join(subagentsDirFor(sessionFile), 'agent-alpha_2.jsonl'),
    );
    expect(subagentTranscriptPath(sessionFile, '../evil')).toBeNull();
    expect(subagentTranscriptPath(sessionFile, 'a/b')).toBeNull();
    expect(subagentTranscriptPath(sessionFile, 'agent.id')).toBeNull();
  });
});

function notificationText(toolUseId: string | null, taskId = 'x'): string {
  const toolUse = toolUseId ? `\n<tool-use-id>${toolUseId}</tool-use-id>` : '';
  return `<task-notification>\n<task-id>${taskId}</task-id>${toolUse}\n<status>completed</status>\n</task-notification>`;
}

const notifiedAt = '2026-09-24T11:00:00.000Z';

function userNotification(toolUseId: string | null, taskId = 'x', timestamp = notifiedAt): string {
  return `${JSON.stringify({
    type: 'user',
    origin: { kind: 'task-notification' },
    timestamp,
    message: { role: 'user', content: notificationText(toolUseId, taskId) },
  })}\n`;
}

function enqueuedNotification(toolUseId: string, timestamp = notifiedAt): string {
  return `${JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp, content: notificationText(toolUseId) })}\n`;
}

describe('conversation subagent status', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'overdeck-subagent-status-'));
    sessionFile = join(tempDir, 'session.jsonl');
    await writeFile(sessionFile, '');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function writeSubagent(
    agentId: string,
    toolUseId: string,
    requestShape: string | undefined,
    lastWriteMs: number,
    { transcript = true } = {},
  ) {
    await writeMeta(agentId, {
      agentType: 'general-purpose',
      description: agentId,
      toolUseId,
      spawnDepth: 1,
      ...(requestShape ? { requestShape } : {}),
    });
    const seconds = lastWriteMs / 1000;
    await utimes(join(subagentsDirFor(sessionFile), `agent-${agentId}.meta.json`), seconds, seconds);
    if (!transcript) return;
    const transcriptPath = join(subagentsDirFor(sessionFile), `agent-${agentId}.jsonl`);
    await writeFile(transcriptPath, '{}\n');
    await utimes(transcriptPath, seconds, seconds);
  }

  const statuses = async (pending: string[], notified: Record<string, number>) =>
    Object.fromEntries((await listSubagentSummaries(sessionFile, new Set(pending), new Map(Object.entries(notified)), now))
      .map((subagent) => [subagent.agentId, subagent.status]));

  it('keeps foreground subagents tied to the pending Agent tool call', async () => {
    await writeSubagent('fg-pending', 'toolu_fg1', undefined, now - 2 * BACKGROUND_SUBAGENT_IDLE_MS);
    await writeSubagent('fg-returned', 'toolu_fg2', undefined, now);
    await writeSubagent('fg-explicit', 'toolu_fg3', 'foreground', now);

    await expect(statuses(['toolu_fg1'], { toolu_fg2: now, toolu_fg3: now - 60_000 })).resolves.toEqual({
      'fg-explicit': 'done',
      'fg-pending': 'running',
      'fg-returned': 'done',
    });
  });

  it('keeps a background subagent running after its launch result until its notification arrives', async () => {
    await writeSubagent('bg', 'toolu_bg', 'background', now - 60_000);

    await expect(statuses([], {})).resolves.toEqual({ bg: 'running' });
    await expect(statuses([], { toolu_bg: now - 59_900 })).resolves.toEqual({ bg: 'done' });
  });

  it('shows a resumed background subagent running again until its next notification', async () => {
    // First notification carried the tool-use id; the resume's carries only the task id.
    await writeSubagent('resumed', 'toolu_resumed', 'background', now - 1000);

    await expect(statuses([], { toolu_resumed: now - 600_000 })).resolves.toEqual({ resumed: 'running' });
    await expect(statuses([], { toolu_resumed: now - 600_000, resumed: now - 900 })).resolves.toEqual({ resumed: 'done' });
  });

  it('marks an unnotified background subagent done once its transcript is idle past the threshold', async () => {
    await writeSubagent('fresh', 'toolu_fresh', 'background', now - BACKGROUND_SUBAGENT_IDLE_MS + 1000);
    await writeSubagent('stale', 'toolu_stale', 'background', now - BACKGROUND_SUBAGENT_IDLE_MS - 1000);
    await writeSubagent('meta-only', 'toolu_meta', 'background', now - BACKGROUND_SUBAGENT_IDLE_MS - 1000, { transcript: false });

    await expect(statuses([], {})).resolves.toEqual({ fresh: 'running', 'meta-only': 'done', stale: 'done' });
  });

  it('collects ids only from real notification records and reads only appended bytes', async () => {
    const scan = createTaskNotificationScanner(sessionFile);
    await appendFile(sessionFile, userNotification('toolu_one'));
    // Quoted in assistant text, a tool result, or a pasted human message: not a notification.
    await appendFile(sessionFile, `${JSON.stringify({ type: 'assistant', timestamp: notifiedAt, message: { content: [{ type: 'text', text: notificationText('toolu_quoted') }] } })}\n`);
    await appendFile(sessionFile, `${JSON.stringify({ type: 'user', timestamp: notifiedAt, message: { content: [{ type: 'tool_result', content: notificationText('toolu_result') }] } })}\n`);
    await appendFile(sessionFile, `${JSON.stringify({ type: 'user', timestamp: notifiedAt, message: { content: notificationText('toolu_pasted') } })}\n`);

    expect(Object.fromEntries(await scan())).toEqual({ toolu_one: Date.parse(notifiedAt), x: Date.parse(notifiedAt) });

    // A record split across two writes is read once it is complete.
    const enqueued = enqueuedNotification('toolu_two', '2026-09-24T11:30:00.000Z');
    await appendFile(sessionFile, enqueued.slice(0, 40));
    expect((await scan()).has('toolu_two')).toBe(false);
    await appendFile(sessionFile, enqueued.slice(40));
    expect((await scan()).get('toolu_two')).toBe(Date.parse('2026-09-24T11:30:00.000Z'));
  });

  it('keeps the latest notification time per id, including task-id-only notifications', async () => {
    await appendFile(sessionFile, userNotification('toolu_a', 'agent-a', '2026-09-24T10:00:00.000Z'));
    await appendFile(sessionFile, userNotification(null, 'agent-a', '2026-09-24T10:40:00.000Z'));

    const notified = await createTaskNotificationScanner(sessionFile)();
    expect(notified.get('toolu_a')).toBe(Date.parse('2026-09-24T10:00:00.000Z'));
    expect(notified.get('agent-a')).toBe(Date.parse('2026-09-24T10:40:00.000Z'));
  });

  it('decodes multibyte text split across chunk boundaries', async () => {
    const filler = `${JSON.stringify({ type: 'assistant', message: { content: 'é€😀'.repeat(50) } })}\n`;
    await writeFile(sessionFile, filler + userNotification('toolu_after_unicode') + filler);

    for (const chunkBytes of [1, 3, 7, 64]) {
      const notified = await createTaskNotificationScanner(sessionFile, chunkBytes)();
      expect(notified.has('toolu_after_unicode')).toBe(true);
    }
  });

  it('rescans a transcript that was rewritten shorter', async () => {
    const scan = createTaskNotificationScanner(sessionFile);
    await appendFile(sessionFile, userNotification('toolu_old_with_long_id', 'old-task-with-a-long-id'));
    expect((await scan()).has('toolu_old_with_long_id')).toBe(true);

    await writeFile(sessionFile, userNotification('toolu_new', 'new'));
    expect([...(await scan()).keys()].sort()).toEqual(['new', 'toolu_new']);
  });

  it('returns no ids for a missing transcript', async () => {
    await rm(sessionFile);
    expect((await createTaskNotificationScanner(sessionFile)()).size).toBe(0);
  });
});
