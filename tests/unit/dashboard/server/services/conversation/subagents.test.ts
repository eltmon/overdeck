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

function notificationText(toolUseId: string): string {
  return `<task-notification>\n<task-id>x</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n</task-notification>`;
}

function userNotification(toolUseId: string): string {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: notificationText(toolUseId) } })}\n`;
}

function enqueuedNotification(toolUseId: string): string {
  return `${JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: notificationText(toolUseId) })}\n`;
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

  async function writeSubagent(agentId: string, toolUseId: string, requestShape: string | undefined, lastWriteMs: number) {
    await writeMeta(agentId, {
      agentType: 'general-purpose',
      description: agentId,
      toolUseId,
      spawnDepth: 1,
      ...(requestShape ? { requestShape } : {}),
    });
    const transcript = join(subagentsDirFor(sessionFile), `agent-${agentId}.jsonl`);
    await writeFile(transcript, '{}\n');
    const seconds = lastWriteMs / 1000;
    await utimes(transcript, seconds, seconds);
    await utimes(join(subagentsDirFor(sessionFile), `agent-${agentId}.meta.json`), seconds, seconds);
  }

  const statuses = async (pending: string[], notified: string[]) =>
    Object.fromEntries((await listSubagentSummaries(sessionFile, new Set(pending), new Set(notified), now))
      .map((subagent) => [subagent.agentId, subagent.status]));

  it('keeps foreground subagents tied to the pending Agent tool call', async () => {
    await writeSubagent('fg-pending', 'toolu_fg1', undefined, now - 2 * BACKGROUND_SUBAGENT_IDLE_MS);
    await writeSubagent('fg-returned', 'toolu_fg2', undefined, now);

    await expect(statuses(['toolu_fg1'], ['toolu_fg2'])).resolves.toEqual({
      'fg-pending': 'running',
      'fg-returned': 'done',
    });
  });

  it('keeps a background subagent running after its launch result until its notification arrives', async () => {
    await writeSubagent('bg', 'toolu_bg', 'background', now - 1000);

    await expect(statuses([], [])).resolves.toEqual({ bg: 'running' });
    await expect(statuses([], ['toolu_bg'])).resolves.toEqual({ bg: 'done' });
  });

  it('marks an unnotified background subagent done once its transcript is idle past the threshold', async () => {
    await writeSubagent('fresh', 'toolu_fresh', 'background', now - BACKGROUND_SUBAGENT_IDLE_MS + 1000);
    await writeSubagent('stale', 'toolu_stale', 'background', now - BACKGROUND_SUBAGENT_IDLE_MS - 1000);

    await expect(statuses([], [])).resolves.toEqual({ fresh: 'running', stale: 'done' });
  });

  it('collects notified tool-use ids by exact match and reads only appended bytes', async () => {
    const scan = createTaskNotificationScanner(sessionFile);
    await appendFile(sessionFile, userNotification('toolu_one'));
    // Quoted in assistant text or a tool result: not a notification.
    await appendFile(sessionFile, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: notificationText('toolu_quoted') }] } })}\n`);
    await appendFile(sessionFile, `${JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: notificationText('toolu_result') }] } })}\n`);

    expect([...await scan()]).toEqual(['toolu_one']);

    // A record split across two writes is read once it is complete.
    const enqueued = enqueuedNotification('toolu_two');
    await appendFile(sessionFile, enqueued.slice(0, 40));
    expect((await scan()).has('toolu_two')).toBe(false);
    await appendFile(sessionFile, enqueued.slice(40));
    const notified = await scan();
    expect([...notified].sort()).toEqual(['toolu_one', 'toolu_two']);
    expect(notified.has('toolu_tw')).toBe(false);
  });

  it('rescans a transcript that was rewritten shorter', async () => {
    const scan = createTaskNotificationScanner(sessionFile);
    await appendFile(sessionFile, userNotification('toolu_old_with_long_id'));
    expect((await scan()).has('toolu_old_with_long_id')).toBe(true);

    await writeFile(sessionFile, userNotification('toolu_new'));
    expect([...await scan()]).toEqual(['toolu_new']);
  });

  it('returns no ids for a missing transcript', async () => {
    await rm(sessionFile);
    expect((await createTaskNotificationScanner(sessionFile)()).size).toBe(0);
  });
});
