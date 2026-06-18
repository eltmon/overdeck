import { describe, expect, it } from 'vitest';
import { summarizeToolInputForWorkLog } from '../format-tool-input.js';

describe('summarizeToolInputForWorkLog', () => {
  it('returns undefined when input is missing', () => {
    expect(summarizeToolInputForWorkLog('Bash', undefined)).toBeUndefined();
  });

  it('prefers Bash description over command', () => {
    expect(
      summarizeToolInputForWorkLog('Bash', {
        description: 'Insert sibling conversation row',
        command: 'node -e "..."',
      }),
    ).toBe('Insert sibling conversation row');
  });

  it('falls back to first line of Bash command when no description', () => {
    expect(
      summarizeToolInputForWorkLog('Bash', {
        command: 'node -e "\nconst db = openDatabase(\':memory:\');\n..."',
      }),
    ).toBe('node -e "');
  });

  it('truncates very long Bash descriptions', () => {
    const long = 'x'.repeat(500);
    const result = summarizeToolInputForWorkLog('Bash', { description: long });
    expect(result?.endsWith('…')).toBe(true);
    expect(result!.length).toBeLessThanOrEqual(160);
  });

  it.each(['Read', 'Write', 'Edit'])(
    'shows basename of file_path for %s',
    (tool) => {
      expect(
        summarizeToolInputForWorkLog(tool, {
          file_path: '/home/eltmon/Projects/overdeck/src/dashboard/server/services/conversation-service.ts',
        }),
      ).toBe('conversation-service.ts');
    },
  );

  it('handles NotebookEdit notebook_path', () => {
    expect(
      summarizeToolInputForWorkLog('NotebookEdit', {
        notebook_path: '/tmp/analysis.ipynb',
      }),
    ).toBe('analysis.ipynb');
  });

  it('formats Grep with pattern and path basename', () => {
    expect(
      summarizeToolInputForWorkLog('Grep', {
        pattern: 'WorkLogEntry',
        path: '/home/eltmon/Projects/overdeck/src/dashboard',
      }),
    ).toBe('"WorkLogEntry" in dashboard');
  });

  it('formats Grep without a path', () => {
    expect(summarizeToolInputForWorkLog('Grep', { pattern: 'foo' })).toBe('"foo"');
  });

  it('formats Glob pattern', () => {
    expect(summarizeToolInputForWorkLog('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
  });

  it('formats WebFetch URL', () => {
    expect(summarizeToolInputForWorkLog('WebFetch', { url: 'https://example.com' })).toBe(
      'https://example.com',
    );
  });

  it('formats WebSearch query in quotes', () => {
    expect(summarizeToolInputForWorkLog('WebSearch', { query: 'effect schema' })).toBe(
      '"effect schema"',
    );
  });

  it('counts TodoWrite items with correct pluralization', () => {
    expect(summarizeToolInputForWorkLog('TodoWrite', { todos: [{}] })).toBe('1 item');
    expect(summarizeToolInputForWorkLog('TodoWrite', { todos: [{}, {}, {}] })).toBe('3 items');
  });

  it('formats Task with subagent and description', () => {
    expect(
      summarizeToolInputForWorkLog('Task', {
        subagent_type: 'general-purpose',
        description: 'Investigate the cache bug',
      }),
    ).toBe('general-purpose: Investigate the cache bug');
  });

  describe('Pi harness (lowercase names, path/command/edits keys)', () => {
    it('shows the first line of a bash command', () => {
      expect(
        summarizeToolInputForWorkLog('bash', {
          command: 'rg -n foo src/\n# more',
          cwd: '/repo',
        }),
      ).toBe('rg -n foo src/');
    });

    it('shows basename for read/write (path key)', () => {
      expect(
        summarizeToolInputForWorkLog('read', { path: '/repo/src/lib/util.ts', offset: 10 }),
      ).toBe('util.ts');
      expect(summarizeToolInputForWorkLog('write', { path: '/repo/README.md', content: 'x' })).toBe(
        'README.md',
      );
    });

    it('appends edit count for multi-edit edit calls', () => {
      expect(
        summarizeToolInputForWorkLog('edit', {
          path: '/repo/src/a.ts',
          edits: [{ oldText: 'a', newText: 'b' }],
        }),
      ).toBe('a.ts');
      expect(
        summarizeToolInputForWorkLog('edit', {
          path: '/repo/src/a.ts',
          edits: [{ oldText: 'a', newText: 'b' }, { oldText: 'c', newText: 'd' }, { oldText: 'e', newText: 'f' }],
        }),
      ).toBe('a.ts · 3 edits');
    });
  });

  it('returns first non-empty string for unknown tools', () => {
    expect(
      summarizeToolInputForWorkLog('mcp__linear__list_issues', {
        team: 'PAN',
        limit: 10,
      }),
    ).toBe('PAN');
  });

  it('returns undefined for unknown tools with no string fields', () => {
    expect(
      summarizeToolInputForWorkLog('mcp__custom__noop', { count: 5, active: true }),
    ).toBeUndefined();
  });
});
