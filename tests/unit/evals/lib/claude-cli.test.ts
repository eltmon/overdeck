import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildClaudeCliArgs,
  buildSessionJsonl,
  callClaudeCli,
  claudeProjectDir,
  evalSessionId,
  parseClaudeCliStream,
} from '../../../../evals/lib/claude-cli.js';
import type { EvalModelConfig } from '../../../../evals/lib/eval-model.js';
import type { ScenarioMessage } from '../../../../evals/lib/prompt-harness.js';

function config(overrides: Partial<EvalModelConfig> = {}): EvalModelConfig {
  return {
    model: 'claude-opus-5-5',
    catalogId: 'claude-opus-5-5',
    apiModel: 'claude-opus-5-5',
    provider: 'anthropic',
    effort: 'high',
    thinking: 'adaptive',
    temperature: null,
    maxTokens: 64000,
    openaiVia: null,
    anthropicVia: 'claude-cli',
    ...overrides,
  };
}

const HAIKU = config({
  model: 'claude-haiku-4-5-20251001',
  catalogId: 'claude-haiku-4-5',
  apiModel: 'claude-haiku-4-5-20251001',
  effort: null,
  thinking: null,
  temperature: 0,
});

// Shape recorded from a 2026-10-01 probe with CLAUDE_CODE_MAX_OUTPUT_TOKENS=300; signatures replaced.
const INIT = '{"type":"system","subtype":"init"}';
const THINKING_A =
  '{"type":"assistant","message":{"id":"msg_A","model":"claude-haiku-4-5-20251001","role":"assistant","content":[{"type":"thinking","thinking":"","signature":"<sig>"}],"stop_reason":null}}';
const TEXT_A =
  '{"type":"assistant","message":{"id":"msg_A","model":"claude-haiku-4-5-20251001","role":"assistant","content":[{"type":"text","text":"1\\n2\\n3"}],"stop_reason":null}}';
const CONTINUE_USER =
  '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces."}]}}';
const TEXT_B =
  '{"type":"assistant","message":{"id":"msg_B","model":"claude-haiku-4-5-20251001","role":"assistant","content":[{"type":"text","text":"4\\n5"}],"stop_reason":null}}';
function resultEvent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    stop_reason: 'end_turn',
    result: '4\n5',
    usage: {
      input_tokens: 2360,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 795,
      output_tokens_details: { thinking_tokens: 185 },
    },
    modelUsage: { 'claude-haiku-4-5': { inputTokens: 2360, outputTokens: 795 } },
    ...overrides,
  });
}
const CONTINUATION_STREAM = [INIT, THINKING_A, TEXT_A, CONTINUE_USER, TEXT_B, resultEvent()].join('\n');

interface FakeCall {
  command: string;
  args: string[];
  options: { cwd?: string; env?: NodeJS.ProcessEnv };
  stdin: string;
}

/** A spawn stand-in: records the call, then emits `stdout` and closes with `code`. */
function fakeSpawn(stdout: string, code = 0, stderr = ''): { spawn: typeof spawn; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fake = (command: string, args: string[], options: FakeCall['options']) => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    const call: FakeCall = { command, args, options, stdin: '' };
    calls.push(call);
    child.stdin.on('data', (chunk: Buffer) => {
      call.stdin += chunk.toString();
    });
    child.stdin.on('finish', () => {
      child.stdout.end(stdout);
      child.stderr.end(stderr);
      setImmediate(() => child.emit('close', code));
    });
    return child;
  };
  return { spawn: fake as unknown as typeof spawn, calls };
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pan4406-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('evals/lib/claude-cli', () => {
  describe('buildClaudeCliArgs', () => {
    it('builds the single-turn argument list for Opus 5.5 at effort high', () => {
      expect(buildClaudeCliArgs(config(), { systemPromptFile: '/tmp/x/system.txt', resumeSessionId: null })).toEqual([
        '-p',
        '--model',
        'claude-opus-5-5',
        '--system-prompt-file',
        '/tmp/x/system.txt',
        '--tools',
        '',
        '--output-format',
        'stream-json',
        '--verbose',
        '--safe-mode',
        '--strict-mcp-config',
        '--setting-sources',
        '',
        '--effort',
        'high',
        '--no-session-persistence',
      ]);
    });

    it('resumes and forks a fabricated session, omits effort when null, and never passes --bare', () => {
      const args = buildClaudeCliArgs(HAIKU, { systemPromptFile: 's.txt', resumeSessionId: 'abc' });
      expect(args.slice(-4)).toEqual(['--resume', 'abc', '--fork-session', '--no-session-persistence']);
      expect(args).not.toContain('--effort');
      expect(args).not.toContain('--bare');
    });
  });

  describe('parseClaudeCliStream', () => {
    it('returns only the first segment and max_tokens when the CLI auto-continues past the output cap', () => {
      const result = parseClaudeCliStream(CONTINUATION_STREAM, HAIKU);
      expect(result.text).toBe('1\n2\n3');
      expect(result.stopReason).toBe('max_tokens');
      expect(result.usage).toEqual({
        inputTokens: 2360,
        outputTokens: 795,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 185,
      });
    });

    it("returns the result's stop reason when no continuation happened", () => {
      const stream = [INIT, THINKING_A, TEXT_A, resultEvent()].join('\n');
      expect(parseClaudeCliStream(stream, HAIKU)).toMatchObject({ text: '1\n2\n3', stopReason: 'end_turn' });
    });

    it('excludes replayed history assistant events and skips non-JSON lines', () => {
      const replayed =
        '{"type":"assistant","message":{"id":"msg_eval_0","role":"assistant","content":[{"type":"text","text":"old progress"}]}}';
      const replayedUser = '{"type":"user","message":{"role":"user","content":"old kickoff"}}';
      const stream = [INIT, replayedUser, replayed, 'not json', TEXT_A, resultEvent()].join('\n');
      expect(parseClaudeCliStream(stream, HAIKU)).toMatchObject({ text: '1\n2\n3', stopReason: 'end_turn' });
    });

    it('rejects a served model other than the configured one', () => {
      const stream = [TEXT_A, resultEvent({ modelUsage: { 'claude-sonnet-5-5': {} } })].join('\n');
      expect(() => parseClaudeCliStream(stream, config())).toThrow(/served unexpected models \[claude-sonnet-5-5\] for claude-opus-5-5/);
    });

    it('rejects an error result and a stream with no result event', () => {
      expect(() => parseClaudeCliStream(resultEvent({ is_error: true, result: 'Not logged in' }), HAIKU)).toThrow(
        'claude CLI error: Not logged in',
      );
      expect(() => parseClaudeCliStream([INIT, TEXT_A].join('\n'), HAIKU)).toThrow('claude CLI produced no result event');
    });
  });

  describe('buildSessionJsonl', () => {
    it('writes one parent-chained row per prior turn, byte-identical for the same inputs', () => {
      const history: ScenarioMessage[] = [
        { role: 'user', content: 'kickoff' },
        { role: 'assistant', content: 'progress' },
      ];
      const opts = { model: 'claude-opus-5-5', cwd: '/tmp/c', sessionId: evalSessionId('claude-opus-5-5', history), history, now: new Date(0) };
      const jsonl = buildSessionJsonl(opts);
      expect(buildSessionJsonl(opts)).toBe(jsonl);
      const rows = jsonl.trimEnd().split('\n').map((l) => JSON.parse(l));
      expect(rows.map((r) => r.type)).toEqual(['user', 'assistant']);
      expect(rows[0].parentUuid).toBeNull();
      expect(rows[1].parentUuid).toBe(rows[0].uuid);
      expect(rows[1].message.id).toBe('msg_eval_1');
      expect(rows[1].message.content).toEqual([{ type: 'text', text: 'progress' }]);
      expect(rows[0].sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  describe('callClaudeCli', () => {
    const messages: ScenarioMessage[] = [
      { role: 'user', content: 'kickoff' },
      { role: 'assistant', content: 'progress' },
      { role: 'user', content: 'review feedback' },
    ];
    const opus = config({ maxTokens: 32000 });
    const opusStream = [TEXT_A, resultEvent({ modelUsage: { 'claude-opus-5-5': {} } })].join('\n');

    it('resumes a deterministic fabricated session, sends the last user turn on stdin and strips ANTHROPIC_API_KEY', async () => {
      const homeDir = tempDir();
      const cwd = tempDir();
      const { spawn: fake, calls } = fakeSpawn(opusStream);
      const previousKey = process.env['ANTHROPIC_API_KEY'];
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
      try {
        const result = await callClaudeCli(opus, { system: 'sys', messages }, { spawn: fake, homeDir, cwd });
        expect(result.text).toBe('1\n2\n3');
      } finally {
        if (previousKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
        else process.env['ANTHROPIC_API_KEY'] = previousKey;
      }

      const id = evalSessionId('claude-opus-5-5', messages.slice(0, -1));
      const [call] = calls;
      expect(call!.command).toBe('claude');
      expect(call!.args).toEqual(expect.arrayContaining(['--resume', id, '--fork-session']));
      expect(call!.stdin).toBe('review feedback');
      expect(call!.options.cwd).toBe(cwd);
      expect(call!.options.env!['ANTHROPIC_API_KEY']).toBeUndefined();
      expect(call!.options.env!['CLAUDE_CODE_MAX_OUTPUT_TOKENS']).toBe('32000');
      const systemFile = call!.args[call!.args.indexOf('--system-prompt-file') + 1]!;
      expect(readFileSync(systemFile, 'utf8')).toBe('sys');

      const sessionFile = path.join(claudeProjectDir(cwd, homeDir), `${id}.jsonl`);
      expect(readFileSync(sessionFile, 'utf8').trimEnd().split('\n')).toHaveLength(2);

      await callClaudeCli(opus, { system: 'sys', messages }, { spawn: fake, homeDir, cwd });
      expect(readdirSync(claudeProjectDir(cwd, homeDir))).toEqual([`${id}.jsonl`]);
    });

    it('writes no session file for a single-turn call', async () => {
      const homeDir = tempDir();
      const cwd = tempDir();
      const { spawn: fake, calls } = fakeSpawn(opusStream);
      await callClaudeCli(opus, { system: 'sys', messages: [{ role: 'user', content: 'only' }] }, { spawn: fake, homeDir, cwd });
      expect(calls[0]!.args).not.toContain('--resume');
      expect(readdirSync(homeDir)).toEqual([]);
    });

    it('rejects with the exit code when the CLI exits non-zero', async () => {
      const { spawn: fake } = fakeSpawn('', 1, 'Not logged in');
      await expect(
        callClaudeCli(opus, { system: 'sys', messages: [{ role: 'user', content: 'x' }] }, { spawn: fake, homeDir: tempDir(), cwd: tempDir() }),
      ).rejects.toThrow(/claude CLI exited 1: Not logged in/);
    });
  });
});
