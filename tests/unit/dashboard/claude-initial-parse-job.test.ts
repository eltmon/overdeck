import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runDashboardDbJob } from '../../../src/dashboard/server/services/dashboard-db-task.js';
import { parseEntireConversation, type ParseResult } from '../../../src/dashboard/server/services/conversation-service.js';

const claudeFixture = new URL(
  '../../../src/dashboard/server/services/__fixtures__/misordered-session.jsonl',
  import.meta.url,
);
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Claude initial transcript parse job', () => {
  it('matches the direct parser and preserves its byte offset', async () => {
    const expected = await parseEntireConversation(claudeFixture.pathname, { flushPendingToolUse: false });
    const actual = await runDashboardDbJob<ParseResult>('parseTranscriptSnapshot', {
      sessionFile: claudeFixture.pathname,
      parser: 'claude-initial',
    });

    expect(actual.messages).toEqual(expected.messages);
    expect(actual.byteOffset).toBe(expected.byteOffset);
  });

  it('preserves parser state collections across a worker-compatible clone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-initial-parse-'));
    tempDirs.push(dir);
    const sessionFile = join(dir, 'session.jsonl');
    writeFileSync(sessionFile, `${JSON.stringify({
      type: 'assistant',
      uuid: 'assistant-with-orphan-edit',
      timestamp: '2026-08-16T00:00:00.000Z',
      message: {
        id: 'message-with-orphan-edit',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'orphan-edit',
          name: 'Edit',
          input: { file_path: '/tmp/example.ts', old_string: 'a', new_string: 'b' },
        }],
        stop_reason: 'tool_use',
      },
    })}\n`);
    const result = await runDashboardDbJob<ParseResult>('parseTranscriptSnapshot', {
      sessionFile,
      parser: 'claude-initial',
    });
    const cloned = structuredClone(result);

    expect(cloned.pendingToolUse).toBeInstanceOf(Map);
    expect(cloned.unresolvedResults).toBeInstanceOf(Map);
    expect(cloned.countedUsageIds).toBeInstanceOf(Set);
    expect(cloned.planToolUseIds).toBeInstanceOf(Set);
    expect(cloned.orphanToolUseIds).toBeInstanceOf(Set);
    expect(cloned.fileEditsByAssistantId).toBeInstanceOf(Map);
  });
});
