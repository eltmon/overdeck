import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { projectPathRef } = vi.hoisted(() => ({ projectPathRef: { current: '' } }));
vi.mock('../../../../../src/lib/projects.js', () => ({
  findProjectByPath: () => ({ name: 'P', path: projectPathRef.current }),
  resolveInfraRepo: (_project: unknown, root: string) => ({ repoPath: root, recordsPath: '.pan' }),
}));

import {
  defaultFactTitle,
  isActiveFact,
  machineMemoryDir,
  matchMemoryFacts,
  MemoryFactExistsError,
  MemoryFactSensitiveError,
  MEMORY_FACT_DESCRIPTION_MAX,
  type MemoryFact,
  parseMemoryFact,
  projectMemoryDir,
  readMemoryFactsSync,
  removeMemoryFact,
  serializeMemoryFact,
  userMemoryDir,
  writeMemoryFact,
} from '../../../../../src/lib/memory/facts/store.js';

describe('memory facts store', () => {
  let tmpRoot: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'overdeck-memory-facts-'));
    previousHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(tmpRoot, 'overdeck-home');
    projectPathRef.current = join(tmpRoot, 'project');
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function baseFact(id: string): Omit<MemoryFact, 'file' | 'scope'> {
    return {
      id,
      type: 'feedback',
      title: defaultFactTitle(id),
      description: 'A description.',
      tags: [],
      updated: '2026-10-20',
      source: null,
      review: [],
      body: 'Body text.',
    };
  }

  describe('parseMemoryFact', () => {
    it('parses a Claude-shaped body with Why/How lines', () => {
      const file = join(tmpRoot, 'be-decisive.md');
      const raw = [
        '---',
        'type: feedback',
        'description: Make routine reversible calls yourself.',
        'tags: [workflow]',
        'updated: 2026-09-23',
        '---',
        '',
        'Make routine reversible calls yourself; ask only for irreversible or operator-owned ones.',
        '',
        '**Why:** Confirmed after choosing this approach without pushback.',
        '**How to apply:** Default to acting; escalate only genuinely risky calls.',
        '',
      ].join('\n');
      const result = parseMemoryFact(file, raw, 'project');
      expect('reason' in result).toBe(false);
      const fact = result as MemoryFact;
      expect(fact.id).toBe('be-decisive');
      expect(fact.type).toBe('feedback');
      expect(fact.title).toBe(defaultFactTitle('be-decisive'));
      expect(fact.description).toBe('Make routine reversible calls yourself.');
      expect(fact.tags).toEqual(['workflow']);
      expect(fact.updated).toBe('2026-09-23');
      expect(fact.body).toContain('**Why:**');
      expect(fact.body).toContain('**How to apply:**');
    });

    it('reports each problem reason', () => {
      const cases: Array<{ raw: string; scope: 'project' | 'user'; reason: string }> = [
        { raw: 'just text\n', scope: 'project', reason: 'no frontmatter' },
        {
          raw: '---\ntype: bogus\ndescription: x\n---\nbody\n',
          scope: 'project',
          reason: 'invalid type "bogus"',
        },
        {
          raw: '---\ntype: user\ndescription: x\n---\nbody\n',
          scope: 'project',
          reason: 'user facts belong in the operator store (~/.overdeck/context/memory)',
        },
        { raw: '---\ntype: feedback\n---\nbody\n', scope: 'project', reason: 'missing description' },
        {
          raw: '---\ntype: feedback\ndescription: "line one\\nline two"\n---\nbody\n',
          scope: 'project',
          reason: 'description must be one line',
        },
        {
          raw: `---\ntype: feedback\ndescription: ${'x'.repeat(MEMORY_FACT_DESCRIPTION_MAX + 1)}\n---\nbody\n`,
          scope: 'project',
          reason: 'description exceeds 200 characters',
        },
        {
          raw: '---\ntype: feedback\ndescription: x\ntags: not-a-list\n---\nbody\n',
          scope: 'project',
          reason: 'tags must be a list of strings',
        },
        {
          raw: '---\ntype: feedback\ndescription: x\nreview: not-a-list\n---\nbody\n',
          scope: 'project',
          reason: 'review must be a list of strings',
        },
        {
          raw: '---\ntype: feedback\ndescription: x\nupdated: not-a-date\n---\nbody\n',
          scope: 'project',
          reason: 'invalid updated date',
        },
      ];

      for (const testCase of cases) {
        const file = join(tmpRoot, 'valid-id.md');
        const result = parseMemoryFact(file, testCase.raw, testCase.scope);
        expect('reason' in result ? result.reason : null).toBe(testCase.reason);
      }
    });

    it('reports invalid id for a filename stem that fails MEMORY_FACT_ID', () => {
      const file = join(tmpRoot, 'Not Valid!.md');
      const raw = '---\ntype: feedback\ndescription: x\n---\nbody\n';
      const result = parseMemoryFact(file, raw, 'project');
      expect('reason' in result && result.reason).toBe('invalid id "Not Valid!"');
    });

    it('reports a machine-specific path in a project-store fact', () => {
      const file = join(tmpRoot, 'valid-id.md');
      const raw = '---\ntype: feedback\ndescription: x\n---\nSee /home/alice/notes for details.\n';
      const projectResult = parseMemoryFact(file, raw, 'project');
      expect('reason' in projectResult && projectResult.reason).toBe(
        'machine-specific path "/home/alice/"; use ~ or a relative path, or keep the fact on this machine with --machine',
      );
    });

    it('user scope refuses a home-directory path with the --machine hint', () => {
      const file = join(tmpRoot, 'valid-id.md');
      const raw = '---\ntype: feedback\ndescription: x\n---\nSee /home/alice/x for details.\n';
      const userResult = parseMemoryFact(file, raw, 'user');
      expect('reason' in userResult && userResult.reason).toBe(
        'machine-specific path "/home/alice/"; use ~ or a relative path, or keep the fact on this machine with --machine',
      );
    });

    it('machine scope accepts a home-directory path and type user', () => {
      const file = join(tmpRoot, 'valid-id.md');
      const raw = '---\ntype: user\ndescription: x\n---\nSee /home/alice/x for details.\n';
      const machineResult = parseMemoryFact(file, raw, 'machine');
      expect('reason' in machineResult).toBe(false);
      expect('reason' in machineResult ? null : machineResult.scope).toBe('machine');
    });

    it('project scope still refuses type user', () => {
      const file = join(tmpRoot, 'valid-id.md');
      const raw = '---\ntype: user\ndescription: x\n---\nbody\n';
      const result = parseMemoryFact(file, raw, 'project');
      expect('reason' in result && result.reason).toBe(
        'user facts belong in the operator store (~/.overdeck/context/memory)',
      );
    });

    it('accepts ~ paths and localhost ports in a project store', () => {
      const file = join(tmpRoot, 'valid-id.md');
      const raw = '---\ntype: feedback\ndescription: x\n---\nSee ~/.overdeck and localhost:3011.\n';
      const result = parseMemoryFact(file, raw, 'project');
      expect('reason' in result).toBe(false);
    });
  });

  describe('readMemoryFactsSync', () => {
    it('skips README.md, dotfiles, subdirectories and non-md files, returning the one valid fact', () => {
      const dir = join(tmpRoot, 'memory');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'README.md'), '# not a fact\n', 'utf8');
      writeFileSync(join(dir, '.hidden.md'), '---\ntype: feedback\ndescription: x\n---\nbody\n', 'utf8');
      mkdirSync(join(dir, 'sub'), { recursive: true });
      writeFileSync(join(dir, 'sub', 'nested.md'), '---\ntype: feedback\ndescription: x\n---\nbody\n', 'utf8');
      writeFileSync(join(dir, 'notes.txt'), 'plain text\n', 'utf8');
      writeFileSync(
        join(dir, 'valid-fact.md'),
        '---\ntype: feedback\ndescription: A valid fact.\n---\nBody text.\n',
        'utf8',
      );

      const { facts, problems } = readMemoryFactsSync(dir, 'project');
      expect(facts).toHaveLength(1);
      expect(facts[0].id).toBe('valid-fact');
      expect(problems).toHaveLength(0);
    });

    it('returns an empty result for a missing directory', () => {
      const result = readMemoryFactsSync(join(tmpRoot, 'does-not-exist'), 'project');
      expect(result).toEqual({ facts: [], problems: [] });
    });
  });

  describe('serializeMemoryFact / parseMemoryFact round trip', () => {
    it('round-trips every field', () => {
      const fact = {
        ...baseFact('be-decisive'),
        title: 'Custom title',
        tags: ['workflow', 'autonomy'],
        source: 'claude:6c30e00a-54f1-4a0e-9d4b-1c2f3e4d5a6b',
        review: ['unindexed'],
        body: 'Make routine reversible calls yourself.\n\n**Why:** because.\n**How to apply:** always.',
      };
      const text = serializeMemoryFact(fact);
      const file = join(tmpRoot, `${fact.id}.md`);
      const parsed = parseMemoryFact(file, text, 'project');
      expect('reason' in parsed).toBe(false);
      const roundTripped = parsed as MemoryFact;
      expect(roundTripped.id).toBe(fact.id);
      expect(roundTripped.type).toBe(fact.type);
      expect(roundTripped.title).toBe(fact.title);
      expect(roundTripped.description).toBe(fact.description);
      expect(roundTripped.tags).toEqual(fact.tags);
      expect(roundTripped.updated).toBe(fact.updated);
      expect(roundTripped.source).toBe(fact.source);
      expect(roundTripped.review).toEqual(fact.review);
      expect(roundTripped.body).toBe(fact.body);
    });

    it('writes frontmatter keys in the order type, title, description, tags, updated, source, review', () => {
      const fact = {
        ...baseFact('ordered-fact'),
        type: 'reference' as const,
        title: 'Not the default title',
        tags: ['a'],
        updated: '2026-01-01',
        source: 'claude:abc',
        review: ['unindexed'],
      };
      const text = serializeMemoryFact(fact);
      const frontmatter = text.slice(text.indexOf('---') + 3, text.indexOf('---', 4));
      const keys = frontmatter
        .split('\n')
        .map((line) => line.match(/^(\w+):/)?.[1])
        .filter((key): key is string => Boolean(key));
      expect(keys).toEqual(['type', 'title', 'description', 'tags', 'updated', 'source', 'review']);
    });

    it('omits title when it equals the default, and omits empty tags/review and null updated/source', () => {
      const fact = { ...baseFact('be-decisive'), tags: [], updated: null, source: null, review: [] };
      const text = serializeMemoryFact(fact);
      expect(text).not.toContain('title:');
      expect(text).not.toContain('tags:');
      expect(text).not.toContain('updated:');
      expect(text).not.toContain('source:');
      expect(text).not.toContain('review:');
    });
  });

  describe('writeMemoryFact', () => {
    it('writes and reads back a fact', async () => {
      const dir = join(tmpRoot, 'memory');
      const file = await writeMemoryFact(dir, 'project', baseFact('new-fact'));
      expect(file).toBe(join(dir, 'new-fact.md'));
      const { facts } = readMemoryFactsSync(dir, 'project');
      expect(facts.map((f) => f.id)).toEqual(['new-fact']);
    });

    it('refuses an existing id without overwrite', async () => {
      const dir = join(tmpRoot, 'memory');
      await writeMemoryFact(dir, 'project', baseFact('dup-fact'));
      await expect(writeMemoryFact(dir, 'project', baseFact('dup-fact'))).rejects.toBeInstanceOf(
        MemoryFactExistsError,
      );
    });

    it('allows overwrite when requested', async () => {
      const dir = join(tmpRoot, 'memory');
      await writeMemoryFact(dir, 'project', baseFact('dup-fact'));
      await expect(
        writeMemoryFact(dir, 'project', { ...baseFact('dup-fact'), description: 'Updated.' }, { overwrite: true }),
      ).resolves.toBe(join(dir, 'dup-fact.md'));
      const { facts } = readMemoryFactsSync(dir, 'project');
      expect(facts[0].description).toBe('Updated.');
    });

    it('refuses sk-ant key and GITHUB_TOKEN=<value> but accepts OVERDECK_RTK_ENABLED=0', async () => {
      const dir = join(tmpRoot, 'memory');
      await expect(
        writeMemoryFact(dir, 'project', { ...baseFact('secret-key'), body: 'Key is sk-ant-abcdef1234567890.' }),
      ).rejects.toBeInstanceOf(MemoryFactSensitiveError);
      await expect(
        writeMemoryFact(dir, 'project', { ...baseFact('secret-token'), body: 'GITHUB_TOKEN=abcdef1234567890' }),
      ).rejects.toBeInstanceOf(MemoryFactSensitiveError);

      const file = await writeMemoryFact(dir, 'project', {
        ...baseFact('rtk-flag'),
        body: 'Re-run with OVERDECK_RTK_ENABLED=0 for raw output.',
      });
      expect(file).toBe(join(dir, 'rtk-flag.md'));
      const { facts, problems } = readMemoryFactsSync(dir, 'project');
      expect(problems).toHaveLength(0);
      expect(facts.map((f) => f.id)).toContain('rtk-flag');
    });

    it('refuses type user in a project store', async () => {
      const dir = join(tmpRoot, 'memory');
      await expect(writeMemoryFact(dir, 'project', { ...baseFact('user-fact'), type: 'user' })).rejects.toThrow(
        'user facts belong in the operator store (~/.overdeck/context/memory)',
      );
    });

    it('refuses a /home/<user>/ path in the project and operator stores and accepts it in the machine store', async () => {
      const projectDir = join(tmpRoot, 'memory-project');
      const userDir = join(tmpRoot, 'memory-user');
      const machineDir = join(tmpRoot, 'memory-machine');
      await expect(
        writeMemoryFact(projectDir, 'project', { ...baseFact('path-fact'), body: 'See /home/alice/notes.' }),
      ).rejects.toThrow(/machine-specific path/);
      await expect(
        writeMemoryFact(userDir, 'user', { ...baseFact('path-fact'), body: 'See /home/alice/notes.' }),
      ).rejects.toThrow(/machine-specific path/);

      await expect(
        writeMemoryFact(machineDir, 'machine', { ...baseFact('path-fact'), body: 'See /home/alice/notes.' }),
      ).resolves.toBe(join(machineDir, 'path-fact.md'));
    });

    it('accepts ~/.overdeck and localhost:3011 in a project store', async () => {
      const dir = join(tmpRoot, 'memory');
      await expect(
        writeMemoryFact(dir, 'project', { ...baseFact('local-fact'), body: 'See ~/.overdeck and localhost:3011.' }),
      ).resolves.toBe(join(dir, 'local-fact.md'));
    });
  });

  describe('removeMemoryFact', () => {
    it('removes an existing fact', async () => {
      const dir = join(tmpRoot, 'memory');
      await writeMemoryFact(dir, 'project', baseFact('to-remove'));
      await removeMemoryFact(dir, 'to-remove');
      expect(readMemoryFactsSync(dir, 'project').facts).toHaveLength(0);
    });

    it('throws when the fact does not exist', async () => {
      const dir = join(tmpRoot, 'memory');
      await expect(removeMemoryFact(dir, 'missing')).rejects.toThrow('no fact "missing"');
    });
  });

  describe('isActiveFact', () => {
    it('is true only when review is empty', () => {
      const fact: MemoryFact = {
        id: 'x',
        scope: 'project',
        type: 'feedback',
        title: 'X',
        description: 'd',
        tags: [],
        updated: null,
        source: null,
        review: [],
        body: '',
        file: join(tmpRoot, 'x.md'),
      };
      expect(isActiveFact(fact)).toBe(true);
      expect(isActiveFact({ ...fact, review: ['unindexed'] })).toBe(false);
    });
  });

  describe('matchMemoryFacts', () => {
    function fact(id: string, description: string, tags: string[], body: string): MemoryFact {
      return {
        id,
        scope: 'project',
        type: 'feedback',
        title: defaultFactTitle(id),
        description,
        tags,
        updated: null,
        source: null,
        review: [],
        body,
        file: `/tmp/${id}.md`,
      };
    }

    function facts(): MemoryFact[] {
      return [
        fact(
          'be-decisive',
          'Make routine reversible calls yourself.',
          ['workflow'],
          'Ask only for irreversible or operator-owned calls.',
        ),
        fact(
          'use-the-pipeline',
          'New issue work goes through pan start.',
          ['pipeline'],
          'Do not bypass with subagents.',
        ),
      ];
    }

    it('requires every whitespace-separated term to match', () => {
      expect(matchMemoryFacts(facts(), 'decisive')).toEqual([facts()[0]]);
      expect(matchMemoryFacts(facts(), 'pipeline bypass')).toEqual([facts()[1]]);
      expect(matchMemoryFacts(facts(), 'pipeline nonexistentterm')).toEqual([]);
      expect(matchMemoryFacts(facts(), '')).toEqual(facts());
    });
  });

  describe('projectMemoryDir / userMemoryDir / machineMemoryDir', () => {
    it('resolves a workspace path to the workspace checkout, not the project root', () => {
      const projectRoot = projectPathRef.current;
      const workspace = join(projectRoot, 'workspaces', 'feature-pan-3957');
      expect(projectMemoryDir(workspace)).toBe(join(workspace, '.overdeck', 'memory'));
      expect(projectMemoryDir(projectRoot)).toBe(join(projectRoot, '.overdeck', 'memory'));
    });

    it('userMemoryDir follows OVERDECK_HOME', () => {
      expect(userMemoryDir()).toBe(join(process.env.OVERDECK_HOME as string, 'context', 'memory'));
    });

    it('machineMemoryDir resolves under OVERDECK_HOME/context/machine-memory', () => {
      expect(machineMemoryDir()).toBe(join(tmpRoot, 'overdeck-home', 'context', 'machine-memory'));
    });
  });
});
