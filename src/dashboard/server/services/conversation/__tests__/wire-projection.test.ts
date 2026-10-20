import type { WorkLogEntry } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import { projectWorkLog, projectWorkLogEntry } from '../wire-projection.js';

function toolEntry(overrides: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return {
    id: 'toolu_1',
    createdAt: '2026-10-19T00:00:00.000Z',
    label: 'Bash',
    tone: 'tool',
    toolTitle: 'Run tests',
    ...overrides,
  };
}

describe('projectWorkLogEntry (PAN-4558)', () => {
  it('replaces a 10 KB result with its byte length', () => {
    const projected = projectWorkLogEntry(toolEntry({ result: 'x'.repeat(10_240) }));
    expect(projected.result).toBeUndefined();
    expect('result' in projected).toBe(false);
    expect(projected.resultBytes).toBe(10_240);
    expect(projected.bodyOmitted).toBe(true);
    expect(projected.toolTitle).toBe('Run tests');
    expect(projected.label).toBe('Bash');
  });

  it('counts the result size in UTF-8 bytes', () => {
    const result = 'é'.repeat(3_000); // 3,000 chars, 6,000 bytes
    const projected = projectWorkLogEntry(toolEntry({ result }));
    expect(projected.resultBytes).toBe(6_000);
  });

  it('returns the same reference for a 1 KB result', () => {
    const entry = toolEntry({ result: 'x'.repeat(1_024), detail: 'short', toolInput: { command: 'ls' } });
    expect(projectWorkLogEntry(entry)).toBe(entry);
  });

  it('cuts a 6 KB error detail to a 512-char preview and keeps the tone', () => {
    const entry = toolEntry({ tone: 'error', detail: `Error: ${'boom '.repeat(1_200)}` });
    const projected = projectWorkLogEntry(entry);
    expect(projected.detail).toHaveLength(513);
    expect(projected.detail!.startsWith('Error: ')).toBe(true);
    expect(projected.detail!.endsWith('…')).toBe(true);
    expect(projected.tone).toBe('error');
    expect(projected.bodyOmitted).toBe(true);
  });

  it('truncates an 8 KB toolInput string and keeps short fields', () => {
    const entry = toolEntry({ label: 'Write', toolInput: { file_path: '/a/b.ts', content: 'y'.repeat(8_192) } });
    const projected = projectWorkLogEntry(entry);
    expect(projected.toolInput!.file_path).toBe('/a/b.ts');
    expect(projected.toolInput!.content).toHaveLength(513);
    expect(projected.bodyOmitted).toBe(true);
    // The parse result keeps the full entry.
    expect((entry.toolInput!.content as string)).toHaveLength(8_192);
  });

  it('truncates a nested toolInput string inside an array', () => {
    const entry = toolEntry({
      label: 'MultiEdit',
      toolInput: { file_path: '/a.ts', edits: [{ old_string: 'a', new_string: 'z'.repeat(5_000) }, { old_string: 'b', new_string: 'c' }] },
    });
    const projected = projectWorkLogEntry(entry);
    const edits = projected.toolInput!.edits as Array<{ old_string: string; new_string: string }>;
    expect(edits[0]!.new_string).toHaveLength(513);
    expect(edits[0]!.old_string).toBe('a');
    expect(edits[1]).toBe((entry.toolInput!.edits as unknown[])[1]);
  });

  it('does not split a surrogate pair at the preview edge', () => {
    const detail = `${'a'.repeat(511)}${'😀'.repeat(3_000)}`;
    const projected = projectWorkLogEntry(toolEntry({ detail }));
    expect(projected.detail).toBe(`${'a'.repeat(511)}…`);
  });

  it('projects every entry in a work log', () => {
    const small = toolEntry({ id: 'a', result: 'ok' });
    const large = toolEntry({ id: 'b', result: 'x'.repeat(5_000) });
    const projected = projectWorkLog([small, large]);
    expect(projected[0]).toBe(small);
    expect(projected[1]!.resultBytes).toBe(5_000);
  });
});
