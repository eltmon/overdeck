/**
 * #4169: the per-harness "newest turn finished" readers behind the Herdr
 * warm-idle reap for panes Herdr does not track (codex, kimi-code, pi/ohmypi,
 * ACP and OpenCode). Each transcript is written in the harness's real format.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { transcriptTurnFinished } from '../transcript-turn.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pan-4169-turn-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, records: ReadonlyArray<unknown>): string {
  const path = join(dir, name);
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
  return path;
}

describe('transcriptTurnFinished', () => {
  describe('codex rollout', () => {
    const started = { type: 'event_msg', payload: { type: 'task_started' } };
    const reply = { type: 'response_item', payload: { type: 'message', role: 'assistant' } };

    it('is finished after task_complete or turn_aborted', async () => {
      for (const end of ['task_complete', 'turn_aborted']) {
        const path = write(`rollout-${end}.jsonl`, [started, reply, { type: 'event_msg', payload: { type: end } }]);
        expect(await transcriptTurnFinished('codex', path)).toBe(true);
      }
    });

    it('is not finished while the newest task has only started', async () => {
      const path = write('rollout.jsonl', [
        started,
        { type: 'event_msg', payload: { type: 'task_complete' } },
        started,
        reply,
      ]);
      expect(await transcriptTurnFinished('codex', path)).toBe(false);
    });
  });

  describe('kimi wire', () => {
    const fixture = readFileSync(join(process.cwd(), 'tests/fixtures/kimi/wire.jsonl'), 'utf8')
      .split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as unknown);
    const stepEnd = (finishReason: string) => ({
      type: 'context.append_loop_event',
      event: { type: 'step.end', turnId: '2', step: 1, finishReason },
    });

    it('is finished when the newest step ended with end_turn (real kimi 0.29.2 capture)', async () => {
      expect(await transcriptTurnFinished('kimi', write('wire.jsonl', fixture))).toBe(true);
    });

    it('is not finished on a new prompt, an open step, or a step that ended to call a tool', async () => {
      const cases = [
        [...fixture, { type: 'turn.prompt', input: [], origin: { kind: 'user' } }],
        [...fixture, { type: 'context.append_loop_event', event: { type: 'step.begin', turnId: '2', step: 1 } }],
        [...fixture, stepEnd('tool_use'), { type: 'usage.record', usageScope: 'turn' }],
      ];
      for (const [index, records] of cases.entries()) {
        expect(await transcriptTurnFinished('kimi', write(`wire-${index}.jsonl`, records))).toBe(false);
      }
    });
  });

  describe('pi session', () => {
    const header = [
      { type: 'session', id: 's1' },
      { type: 'message', message: { role: 'user', content: 'rank the backlog' } },
      { type: 'message', message: { role: 'assistant', stopReason: 'toolUse' } },
      { type: 'message', message: { role: 'toolResult' } },
    ];

    it('is finished after an assistant message that stopped or was aborted', async () => {
      for (const stopReason of ['stop', 'aborted']) {
        const path = write(`pi-${stopReason}.jsonl`, [...header, { type: 'message', message: { role: 'assistant', stopReason } }]);
        expect(await transcriptTurnFinished('pi', path)).toBe(true);
        expect(await transcriptTurnFinished('ohmypi', path)).toBe(true);
      }
    });

    it('is not finished after a tool call, a tool result, or a provider error Pi may retry', async () => {
      const cases = [
        header,
        [...header.slice(0, 3)],
        [...header, { type: 'message', message: { role: 'assistant', stopReason: 'error' } }],
      ];
      for (const [index, records] of cases.entries()) {
        expect(await transcriptTurnFinished('pi', write(`pi-${index}.jsonl`, records))).toBe(false);
      }
    });
  });

  describe('ACP host transcript (ACP and OpenCode)', () => {
    const turn = [
      { role: 'system', content: 'queued', event: 'prompt_queued', promptId: 'p1' },
      { role: 'user', content: 'rank the backlog', promptId: 'p1' },
      { role: 'assistant', content: 'done' },
    ];

    it('is finished after turn_completed or prompt_failed', async () => {
      for (const event of ['turn_completed', 'prompt_failed']) {
        const path = write(`acp-${event}.jsonl`, [...turn, { role: 'system', content: '', event, promptId: 'p1', stopReason: 'end_turn' }]);
        expect(await transcriptTurnFinished('acp', path)).toBe(true);
      }
    });

    it('is not finished mid-turn, on a stalled prompt, or with a newer prompt queued', async () => {
      const completed = { role: 'system', content: '', event: 'turn_completed', promptId: 'p1' };
      const cases = [
        turn,
        [...turn, { role: 'system', content: 'stalled', event: 'prompt_stalled', promptId: 'p1' }],
        [...turn, completed, { role: 'system', content: 'next', event: 'prompt_queued', promptId: 'p2' }],
      ];
      for (const [index, records] of cases.entries()) {
        expect(await transcriptTurnFinished('acp', write(`acp-${index}.jsonl`, records))).toBe(false);
      }
    });
  });

  it('answers false for kinds it has no reader for, and for a missing or non-regular path', async () => {
    const claude = write('claude.jsonl', [{ type: 'assistant', message: { stop_reason: 'end_turn' } }]);
    expect(await transcriptTurnFinished('claude', claude)).toBe(false);
    expect(await transcriptTurnFinished('muse', claude)).toBe(false);
    expect(await transcriptTurnFinished('kimi', join(dir, 'missing.jsonl'))).toBe(false);
    expect(await transcriptTurnFinished('codex', join(dir, 'missing.jsonl'))).toBe(false);
    expect(await transcriptTurnFinished('acp', dir)).toBe(false);
  });
});
