import { describe, expect, it, vi } from 'vitest';
import { SEED_DIGEST_MAX_BYTES, buildSeedDigest, collectTurns, seedFileName, seedHeader } from '../../../../src/lib/vault/seed.js';

function user(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
}
function assistant(text: string): string {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
}

const record = { title: 'Fix the "parser"', harness: 'claude-code', cwd: '/w/repo', vaultId: 'v-1' };

describe('vault seed digest (P-16)', () => {
  it('collects human turns with the final assistant text of each, skipping injected lines', () => {
    const lines = [
      user('first'),
      assistant('thinking aloud'),
      assistant('final answer one'),
      user('<task-notification>ignored</task-notification>'),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }),
      user('second'),
    ];
    expect(collectTurns(lines, 'claude-code')).toEqual([
      { human: 'first', assistant: 'final answer one' },
      { human: 'second', assistant: null },
    ]);
    const codex = [
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'codex prompt' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'codex reply' }] } }),
    ];
    expect(collectTurns(codex, 'codex')).toEqual([{ human: 'codex prompt', assistant: 'codex reply' }]);
  });

  it('starts with the [Session Vault] header and renders every turn when it fits', () => {
    const digest = buildSeedDigest(record, [user('q1'), assistant('a1'), user('q2')]);
    expect(digest.startsWith(seedHeader(record.title))).toBe(true);
    expect(digest.startsWith('[Session Vault] Seeded continuation of "Fix the \\"parser\\"" (not a native resume)')).toBe(true);
    expect(digest).toContain('## Turn 1');
    expect(digest).toContain('q1');
    expect(digest).toContain('a1');
    expect(digest).toContain('## Turn 2');
    expect(digest).toContain('Saved cwd: /w/repo');
    expect(digest).not.toContain('omitted');
  });

  it('ac1: 40 KB of turns is capped at 32 KB, keeps the header, drops the oldest turns, makes no network call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) {
      lines.push(user(`question ${i} ${'q'.repeat(500)}`));
      lines.push(assistant(`answer ${i} ${'a'.repeat(500)}`));
    }
    expect(lines.join('\n').length).toBeGreaterThan(40 * 1024);
    const digest = buildSeedDigest(record, lines);
    expect(Buffer.byteLength(digest, 'utf8')).toBeLessThanOrEqual(SEED_DIGEST_MAX_BYTES);
    expect(digest.startsWith(seedHeader(record.title))).toBe(true);
    expect(digest).toMatch(/_\d+ earlier turns omitted to fit the size cap\._/);
    expect(digest).toContain('question 39');
    expect(digest).not.toContain('question 0 ');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('a single oversized turn is truncated but still under the cap with the header intact', () => {
    const digest = buildSeedDigest(record, [user('x'.repeat(50 * 1024))]);
    expect(Buffer.byteLength(digest, 'utf8')).toBeLessThanOrEqual(SEED_DIGEST_MAX_BYTES);
    expect(digest.startsWith(seedHeader(record.title))).toBe(true);
  });

  it('names the seed file by vaultId', () => {
    expect(seedFileName('abc-123')).toBe('.overdeck-vault-seed-abc-123.md');
  });
});
