import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateFallbackSummary } from '../summary-fork.js';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'pan-summary-fork-fallback-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('generateFallbackSummary', () => {
  it('summarizes Codex user messages and tool calls through the transcript adapter', async () => {
    const file = join(workDir, 'codex-rollout.jsonl');
    await writeFile(file, [
      JSON.stringify({ type: 'session_meta', payload: { id: 't1' } }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Fix the Codex fallback summary' },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"ls"}' },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch' },
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'The fallback summary is fixed' },
      }),
    ].join('\n') + '\n', 'utf-8');

    const summary = await Effect.runPromise(generateFallbackSummary(file, 'codex'));

    expect(summary).toContain('### User Messages:\n- Fix the Codex fallback summary');
    expect(summary).toContain('### Tools Used: apply_patch, exec_command');
  });

  it('preserves the default Claude transcript path when no harness is provided', async () => {
    const file = join(workDir, 'claude-session.jsonl');
    await writeFile(file, `${JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'Keep the Claude fallback behavior' },
    })}\n`, 'utf-8');

    const summary = await Effect.runPromise(generateFallbackSummary(file));

    expect(summary).toContain('### User Messages:\n- Keep the Claude fallback behavior');
  });
});
