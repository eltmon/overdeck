import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { compressJsonlBuffer, compressTranscriptDelta, MAX_TRANSCRIPT_DELTA_BYTES } from '../../../src/lib/memory/compress.js';

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function jsonl(entry: unknown): string {
  return `${JSON.stringify(entry)}\n`;
}

describe('compressTranscriptDelta', () => {
  it('reads only the requested byte range and compresses user, assistant, and tool calls', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-compress-'));
    const transcriptPath = join(tempDir, 'session.jsonl');
    const prefix = jsonl({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'outside range' }] } });
    const line1 = jsonl({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'build compressor' }] } });
    const line2 = jsonl({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'done' },
          { type: 'tool_use', name: 'Write', input: { file_path: 'src/lib/memory/compress.ts' } },
          { type: 'tool_use', name: 'Edit', input: { file_path: 'tests/lib/memory/compress.test.ts' } },
          { type: 'tool_use', name: 'Bash', input: { command: 'npm test -- tests/lib/memory/compress.test.ts' } },
          { type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } },
        ],
      },
    });
    await writeFile(transcriptPath, prefix + line1 + line2, 'utf8');

    const result = await compressTranscriptDelta({
      transcriptPath,
      fromOffset: Buffer.byteLength(prefix, 'utf8'),
      toOffset: Buffer.byteLength(prefix + line1 + line2, 'utf8'),
    });

    expect(result.text).toBe([
      'U: build compressor',
      'A: done',
      'Created: src/lib/memory/compress.ts',
      'Updated: tests/lib/memory/compress.test.ts',
      'Bash: npm test -- tests/lib/memory/compress.test.ts',
      'Tool(Read): README.md',
    ].join('\n'));
    expect(result.eventsConsumed).toBe(2);
    expect(result.lastFullLineOffset).toBe(Buffer.byteLength(prefix + line1 + line2, 'utf8'));
  });

  it('preserves trailing partial JSONL by returning the last full line offset', () => {
    const fullLine = jsonl({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'complete' }] } });
    const partial = '{"type":"assistant"';
    const result = compressJsonlBuffer(fullLine + partial, 100);

    expect(result.text).toBe('U: complete');
    expect(result.eventsConsumed).toBe(1);
    expect(result.lastFullLineOffset).toBe(100 + Buffer.byteLength(fullLine, 'utf8'));
  });

  it('limits transcript delta reads to a bounded slice and advances the checkpoint for oversized partial chunks', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-compress-'));
    const transcriptPath = join(tempDir, 'session.jsonl');
    await writeFile(transcriptPath, 'x'.repeat(MAX_TRANSCRIPT_DELTA_BYTES + 100), 'utf8');

    const result = await compressTranscriptDelta({
      transcriptPath,
      fromOffset: 0,
      toOffset: MAX_TRANSCRIPT_DELTA_BYTES + 100,
    });

    expect(result).toEqual({
      text: '',
      eventsConsumed: 0,
      lastFullLineOffset: MAX_TRANSCRIPT_DELTA_BYTES,
    });
  });

  it('returns no events when the range contains only a partial line', () => {
    expect(compressJsonlBuffer('{"type":"user"', 50)).toEqual({
      text: '',
      eventsConsumed: 0,
      lastFullLineOffset: 50,
    });
  });

  it('truncates oversized user content with a marker', () => {
    const longText = 'x'.repeat(40_005);
    const result = compressJsonlBuffer(jsonl({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: longText }] },
    }));

    expect(result.text).toContain('[truncated 5 chars]');
    expect(result.text).toContain(`U: ${'x'.repeat(40_000)}`);
    expect(result.text).not.toContain('x'.repeat(40_005));
  });
});
