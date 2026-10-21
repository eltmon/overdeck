import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { projectPathRef, throwOnRead } = vi.hoisted(() => ({
  projectPathRef: { current: '' },
  throwOnRead: { current: false },
}));
vi.mock('../../../../../src/lib/projects.js', () => ({
  findProjectByPath: () => ({ name: 'P', path: projectPathRef.current }),
  resolveInfraRepo: (_project: unknown, root: string) => ({ repoPath: root, recordsPath: '.pan' }),
}));
vi.mock('../../../../../src/lib/memory/facts/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/memory/facts/store.js')>();
  return {
    ...actual,
    readMemoryFactsSync: (dir: string, scope: 'project' | 'user' | 'machine') => {
      if (throwOnRead.current) throw new Error('boom');
      return actual.readMemoryFactsSync(dir, scope);
    },
  };
});

import type { MemoryFact } from '../../../../../src/lib/memory/facts/store.js';
import {
  MACHINE_MEMORY_CHAR_BUDGET,
  OPERATOR_MEMORY_CHAR_BUDGET,
  PROJECT_MEMORY_CHAR_BUDGET,
  renderManagedMemorySections,
  renderMemoryIndexSection,
} from '../../../../../src/lib/memory/facts/render.js';

function fact(overrides: Partial<MemoryFact> & { id: string }): MemoryFact {
  return {
    scope: 'project',
    type: 'feedback',
    title: overrides.id,
    description: `${overrides.id} description.`,
    tags: [],
    updated: null,
    source: null,
    review: [],
    body: '',
    file: `/tmp/${overrides.id}.md`,
    ...overrides,
  };
}

describe('renderMemoryIndexSection', () => {
  it('renders the exact D7 header and one line per active fact', () => {
    const facts = [
      fact({ id: 'be-decisive', type: 'feedback', description: 'Make routine reversible calls yourself; ask only for irreversible or operator-owned ones.' }),
    ];
    const section = renderMemoryIndexSection({ scope: 'project', dir: '/repo/.overdeck/memory', facts, budget: PROJECT_MEMORY_CHAR_BUDGET });
    expect(section).toBe(
      [
        '## Project memory',
        '',
        'Source: /repo/.overdeck/memory (1 active facts, curated and committed with this repository)',
        'One line per fact. Open the fact (`pan memory show <id>`) before relying on its details.',
        'Record a new durable fact with `pan memory add`; never write harness-native memory.',
        '',
        '- feedback/be-decisive: Make routine reversible calls yourself; ask only for irreversible or operator-owned ones.',
      ].join('\n'),
    );
  });

  it('orders feedback, project, reference, then updated desc, then id', () => {
    const facts = [
      fact({ id: 'ref-a', type: 'reference', updated: '2026-01-01' }),
      fact({ id: 'proj-a', type: 'project', updated: '2026-01-01' }),
      fact({ id: 'fb-old', type: 'feedback', updated: '2026-01-01' }),
      fact({ id: 'fb-new', type: 'feedback', updated: '2026-06-01' }),
      fact({ id: 'fb-none', type: 'feedback', updated: null }),
      fact({ id: 'fb-aaa', type: 'feedback', updated: '2026-01-01' }),
    ];
    const section = renderMemoryIndexSection({ scope: 'project', dir: '/repo/.overdeck/memory', facts, budget: PROJECT_MEMORY_CHAR_BUDGET });
    const ids = section
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.match(/\/([a-z0-9-]+):/)?.[1]);
    expect(ids).toEqual(['fb-new', 'fb-aaa', 'fb-old', 'fb-none', 'proj-a', 'ref-a']);
  });

  it('excludes facts with a review marker', () => {
    const facts = [
      fact({ id: 'active-fact' }),
      fact({ id: 'marked-fact', review: ['unindexed'] }),
    ];
    const section = renderMemoryIndexSection({ scope: 'project', dir: '/repo/.overdeck/memory', facts, budget: PROJECT_MEMORY_CHAR_BUDGET });
    expect(section).toContain('active-fact');
    expect(section).not.toContain('marked-fact');
  });

  it("returns '' when no active facts", () => {
    expect(renderMemoryIndexSection({ scope: 'project', dir: '/repo', facts: [], budget: PROJECT_MEMORY_CHAR_BUDGET })).toBe('');
    expect(
      renderMemoryIndexSection({
        scope: 'project',
        dir: '/repo',
        facts: [fact({ id: 'marked', review: ['unindexed'] })],
        budget: PROJECT_MEMORY_CHAR_BUDGET,
      }),
    ).toBe('');
  });

  it('stops at budget and appends the overflow line', () => {
    const facts = Array.from({ length: 300 }, (_, i) =>
      fact({ id: `fact-${String(i).padStart(4, '0')}`, description: 'x'.repeat(150) }),
    );
    const section = renderMemoryIndexSection({ scope: 'project', dir: '/repo', facts, budget: PROJECT_MEMORY_CHAR_BUDGET });
    expect(section.length).toBeLessThanOrEqual(PROJECT_MEMORY_CHAR_BUDGET);
    expect(section).toContain('more facts: run `pan memory list`');
  });

  it('operator section uses --user in its hints', () => {
    const facts = [fact({ id: 'op-fact' })];
    const section = renderMemoryIndexSection({ scope: 'user', dir: '/home/op/.overdeck/context/memory', facts, budget: OPERATOR_MEMORY_CHAR_BUDGET });
    expect(section).toContain('## Operator memory');
    expect(section).toContain('not synced; pan memory sync --setup <git-url> shares it across machines');
    expect(section).toContain('pan memory show --user <id>');

    const many = Array.from({ length: 200 }, (_, i) => fact({ id: `op-${String(i).padStart(4, '0')}`, description: 'x'.repeat(150) }));
    const overflowed = renderMemoryIndexSection({ scope: 'user', dir: '/home/op/.overdeck/context/memory', facts: many, budget: OPERATOR_MEMORY_CHAR_BUDGET });
    expect(overflowed).toContain('more facts: run `pan memory list --user`');
  });

  it('machine section is bounded at 2000 chars', () => {
    const facts = Array.from({ length: 300 }, (_, i) =>
      fact({ id: `m-${String(i).padStart(4, '0')}`, scope: 'machine', description: 'x'.repeat(150) }),
    );
    const section = renderMemoryIndexSection({ scope: 'machine', dir: '/m', facts, budget: MACHINE_MEMORY_CHAR_BUDGET });
    expect(MACHINE_MEMORY_CHAR_BUDGET).toBe(2_000);
    expect(section.length).toBeLessThanOrEqual(MACHINE_MEMORY_CHAR_BUDGET);
    expect(section).toContain('more facts: run `pan memory list --machine`');
  });
});

describe('renderManagedMemorySections', () => {
  let tmpRoot: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'overdeck-memory-render-'));
    previousHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(tmpRoot, 'overdeck-home');
    projectPathRef.current = join(tmpRoot, 'project');
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeFact(dir: string, id: string, body: string) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.md`), body, 'utf8');
  }

  it('composes project and operator sections separated by a divider', () => {
    const projectRoot = projectPathRef.current;
    writeFact(
      join(projectRoot, '.overdeck', 'memory'),
      'be-decisive',
      '---\ntype: feedback\ndescription: Make routine reversible calls yourself.\n---\nBody.\n',
    );
    const userDir = join(tmpRoot, 'operator-memory');
    writeFact(userDir, 'terse-answers', '---\ntype: user\ndescription: Keep answers terse.\n---\nBody.\n');

    const text = renderManagedMemorySections(projectRoot, { userDir });
    expect(text.indexOf('## Project memory')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('## Operator memory')).toBeGreaterThan(text.indexOf('## Project memory'));
    expect(text).toContain('\n\n---\n\n');
  });

  it('operator section says synced when the store has .git', () => {
    const userDir = join(tmpRoot, 'operator-memory');
    writeFact(userDir, 'terse-answers', '---\ntype: user\ndescription: Keep answers terse.\n---\nBody.\n');
    mkdirSync(join(userDir, '.git'));
    const text = renderManagedMemorySections(null, { userDir });
    expect(text).toContain('synced across your machines by pan memory sync');
    expect(text).not.toContain('not synced');
  });

  it('machine section renders after operator memory with --machine hints', () => {
    const userDir = join(tmpRoot, 'operator-memory');
    const machineDir = join(tmpRoot, 'machine-memory');
    writeFact(userDir, 'terse-answers', '---\ntype: user\ndescription: Keep answers terse.\n---\nBody.\n');
    writeFact(machineDir, 'gpu', '---\ntype: reference\ndescription: The GPU is an RTX 3090.\n---\nSee /home/op/gpu.\n');
    const text = renderManagedMemorySections(null, { userDir, machineDir });
    expect(text.indexOf('## Machine memory')).toBeGreaterThan(text.indexOf('## Operator memory'));
    expect(text).toContain(`Source: ${machineDir} (1 active facts, this machine only, never synced)`);
    expect(text).toContain('pan memory show --machine <id>');
    expect(text).toContain('- reference/gpu: The GPU is an RTX 3090.');
  });

  it('empty machine store renders no section', () => {
    const userDir = join(tmpRoot, 'operator-memory');
    writeFact(userDir, 'terse-answers', '---\ntype: user\ndescription: Keep answers terse.\n---\nBody.\n');
    const text = renderManagedMemorySections(null, { userDir, machineDir: join(tmpRoot, 'empty-machine') });
    expect(text).toContain('## Operator memory');
    expect(text).not.toContain('## Machine memory');
  });

  it('renders no section when both stores are empty', () => {
    const text = renderManagedMemorySections(projectPathRef.current, { userDir: join(tmpRoot, 'empty-user') });
    expect(text).toBe('');
  });

  it('returns null project section when projectRoot is null, still rendering operator memory', () => {
    const userDir = join(tmpRoot, 'operator-memory');
    writeFact(userDir, 'terse-answers', '---\ntype: user\ndescription: Keep answers terse.\n---\nBody.\n');
    const text = renderManagedMemorySections(null, { userDir });
    expect(text).not.toContain('## Project memory');
    expect(text).toContain('## Operator memory');
  });

  it('swallows a throwing reader and warns once', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    throwOnRead.current = true;
    try {
      const text = renderManagedMemorySections(projectPathRef.current, { userDir: join(tmpRoot, 'empty-user') });
      expect(text).toBe('');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain('[memory] facts unavailable: boom');
    } finally {
      throwOnRead.current = false;
    }
  });
});
