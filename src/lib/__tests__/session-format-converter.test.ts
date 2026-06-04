import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { extractCodexTranscript, convertConversationTranscript } from '../session-format-converter.js';

const FIXTURE_DIR = join(__dirname, '..', 'cost-parsers', '__tests__', 'fixtures');

describe('extractCodexTranscript', () => {
  it('parses a fixture rollout JSONL into transcript turns', () => {
    const raw = readFileSync(join(FIXTURE_DIR, 'codex', 'rollout.jsonl'), 'utf-8');
    const turns = extractCodexTranscript(raw);
    expect(turns.length).toBe(3);
    expect(turns[0]).toEqual({ role: 'user', text: 'Fix the bug in src/lib/foo.ts' });
    expect(turns[1]).toMatchObject({ role: 'assistant', text: expect.stringContaining('line 42') });
    expect(turns[2]).toMatchObject({ role: 'assistant', text: expect.stringContaining('optional chain') });
  });

  it('skips token_count and unknown event types', () => {
    const raw = [
      '{"type":"token_count","input":100,"output":50}',
      '{"type":"unknown_event","data":"ignored"}',
      '{"type":"agent_message","content":"Hello"}',
    ].join('\n');
    const turns = extractCodexTranscript(raw);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toEqual({ role: 'assistant', text: 'Hello' });
  });

  it('returns empty array for empty or invalid input', () => {
    expect(extractCodexTranscript('')).toEqual([]);
    expect(extractCodexTranscript('not json\n')).toEqual([]);
  });

  it('does not fall through to Claude extractor for codex content', () => {
    // Codex rollout has agent_message, not user/assistant type records
    const codexRaw = '{"type":"agent_message","content":"codex turn"}';
    const turns = extractCodexTranscript(codexRaw);
    expect(turns[0]?.role).toBe('assistant');
    expect(turns[0]?.text).toBe('codex turn');
  });
});

describe('convertConversationTranscript — round-trip to codex', () => {
  let tmpBase: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), 'pan-conv-convert-'));
    originalHome = process.env['HOME'];
    // Redirect HOME so writeThreadId writes under our tmpBase
    process.env['HOME'] = tmpBase;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = originalHome;
    }
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('converts a Claude-format JSONL to a codex rollout and persists the thread-id', async () => {
    // Seed a minimal Claude-format source session.
    const srcDir = join(tmpBase, 'claude-project');
    mkdirSync(srcDir, { recursive: true });
    const sourceSessionFile = join(srcDir, 'source-session.jsonl');
    const claudeRecord = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'Please fix the login bug' },
      uuid: 'uuid-001',
      sessionId: 'src-session',
      timestamp: '2025-06-01T10:00:00Z',
    });
    writeFileSync(sourceSessionFile, `${claudeRecord}\n`);

    const tmuxSession = 'conv-test-20260601-1234';
    const cwd = join(tmpBase, 'workspace');
    mkdirSync(cwd, { recursive: true });

    // Ensure the panopticon agent dir exists (writeThreadId writes here)
    const agentDir = join(tmpBase, '.panopticon', 'agents', tmuxSession);
    mkdirSync(agentDir, { recursive: true });

    const result = await Effect.runPromise(
      convertConversationTranscript({
        fromHarness: 'claude-code',
        toHarness: 'codex',
        sourceSessionFile,
        cwd,
        tmuxSession,
      }),
    );

    // Should return a valid thread-id as sessionId
    expect(result.sessionId).toBeTruthy();
    expect(result.sessionId.length).toBeGreaterThan(4);

    // The target rollout JSONL should exist
    expect(existsSync(result.targetSessionFile)).toBe(true);

    // The thread-id file should be persisted
    const threadIdPath = join(tmpBase, '.panopticon', 'agents', tmuxSession, 'codex-thread-id');
    expect(existsSync(threadIdPath)).toBe(true);
    const storedThreadId = readFileSync(threadIdPath, 'utf-8').trim();
    expect(storedThreadId).toBe(result.sessionId);

    // The rollout JSONL should contain a task_started record with the carried transcript
    const rolloutContent = readFileSync(result.targetSessionFile, 'utf-8');
    const firstLine = JSON.parse(rolloutContent.split('\n')[0]!);
    expect(firstLine.type).toBe('task_started');
    expect(firstLine.thread_id).toBe(result.sessionId);
    expect(firstLine.task).toContain('fix the login bug');
  });
});
