/**
 * PAN-3668 WI-18 (FR-11): a Prime Agent session JSONL renders in the conversation
 * feed — user and assistant text, thinking, tool calls joined to their results, an
 * error tool result, compaction, and failed or aborted turns. Other entry types
 * (model_change, agent_status, session_state, child_usage_attributed) are skipped.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parsePrimeAgentConversationMessages } from '../../../../src/dashboard/server/services/prime-agent-conversation-parser.js';

const FIXTURE = join(import.meta.dirname, '../../../fixtures/prime-agent/session.jsonl');

describe('parsePrimeAgentConversationMessages (PAN-3668 WI-18)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pan-prime-parser-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('renders user and assistant text in order', async () => {
    const result = await parsePrimeAgentConversationMessages(FIXTURE);
    expect(result.messages.map((message) => [message.role, message.text])).toEqual([
      ['user', 'Count the files in the repo.'],
      ['assistant', 'The repository root has 42 entries.'],
      ['user', 'Now summarize the README.'],
    ]);
  });

  it('renders thinking, the tool call joined to its error result, compaction, and the aborted turn', async () => {
    const result = await parsePrimeAgentConversationMessages(FIXTURE);

    expect(result.workLog.find((entry) => entry.tone === 'thinking')?.detail).toBe('I should list the files with Python first.');
    const tool = result.workLog.find((entry) => entry.toolTitle === 'python');
    expect(tool).toMatchObject({ tone: 'error', result: "PermissionError: [Errno 13] Permission denied: '.'" });
    expect(tool?.toolInput).toEqual({ code: "import os\nprint(len(os.listdir('.')))" });
    expect(result.compactBoundaries).toEqual([{ id: 'k0000001', timestamp: '2026-09-25T10:05:00.000Z', trigger: 'compaction' }]);
    expect(result.workLog.find((entry) => entry.label === 'Turn aborted')).toMatchObject({ tone: 'error', detail: 'Request was aborted.' });
  });

  it('marks the turn finished at the last terminal assistant message', async () => {
    const result = await parsePrimeAgentConversationMessages(FIXTURE);
    expect(result.lastTurnCompletedAt).toBe('2026-09-25T10:06:02.000Z');
  });

  it('counts every assistant message, with child_usage_attributed aggregate usage replacing its target', async () => {
    const result = await parsePrimeAgentConversationMessages(FIXTURE);
    // a0000001 (tool-only) counts its aggregate 1300+250+500+100 = 2150 tokens, $0.0041,
    // not its own 1800; a0000002 counts 3600 tokens, $0.0033; the aborted a0000003 is 0.
    expect(result.totalTokens).toBe(5750);
    expect(result.totalCost).toBeCloseTo(0.0074, 6);
  });

  it('renders a provider failure (real 0.8.0 shape) as a failed-turn row and ends the turn', async () => {
    const file = join(dir, 'failed.jsonl');
    writeFileSync(file, [
      JSON.stringify({ type: 'session', version: 3, id: 'sid', timestamp: '2026-09-26T03:50:18.773Z', cwd: '/w' }),
      JSON.stringify({ type: 'message', id: '02623e6d', parentId: null, timestamp: '2026-09-26T03:50:26.192Z', message: { role: 'user', content: [{ type: 'text', text: 'Reply with the single word ok.' }] } }),
      JSON.stringify({ type: 'message', id: 'd66b7ba7', parentId: '02623e6d', timestamp: '2026-09-26T03:50:27.614Z', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Provider authentication failed (permission_error, 403)' } }),
      JSON.stringify({ type: 'agent_status', id: '8ed117b1', parentId: 'd66b7ba7', timestamp: '2026-09-26T03:50:32.798Z', status: { taskState: 'needs_input' } }),
      JSON.stringify({ type: 'brand_new_entry_type', id: 'x1', parentId: '8ed117b1', timestamp: '2026-09-26T03:50:33.000Z' }),
      'not json',
    ].join('\n'));

    const result = await parsePrimeAgentConversationMessages(file);
    expect(result.messages.map((message) => message.role)).toEqual(['user']);
    expect(result.workLog).toEqual([expect.objectContaining({ label: 'Turn failed', tone: 'error', detail: 'Provider authentication failed (permission_error, 403)' })]);
    expect(result.lastTurnCompletedAt).toBe('2026-09-26T03:50:27.614Z');
  });
});
