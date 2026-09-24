import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { extractCodexTranscript } from '../session-format-converter.js';

const FIXTURE_DIR = join(__dirname, '..', 'cost-parsers', '__tests__', 'fixtures');

describe('extractCodexTranscript', () => {
  it('parses a fixture rollout JSONL into transcript turns', () => {
    const raw = readFileSync(join(FIXTURE_DIR, 'codex', 'rollout.jsonl'), 'utf-8');
    const turns = extractCodexTranscript(raw);
    expect(turns.length).toBe(3);
    expect(turns[0]).toEqual({ role: 'user', text: '[synthetic task]' });
    expect(turns[1]).toMatchObject({ role: 'assistant', text: '[synthetic agent content]' });
    expect(turns[2]).toMatchObject({ role: 'assistant', text: '[synthetic agent content]' });
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

