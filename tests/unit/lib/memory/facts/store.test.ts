import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  MemoryFactSupersedeError,
  MEMORY_FACT_DESCRIPTION_MAX,
  type MemoryFact,
  parseMemoryFact,
  projectMemoryDir,
  readMemoryFactsSync,
  removeMemoryFact,
  serializeMemoryFact,
  userMemoryDir,
  writeMemoryFact,
  writeSupersedingFact,
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
      created: null,
      updated: '2026-10-20',
      source: null,
      status: 'active',
      supersedes: [],
      supersededBy: null,
      review: [],
      extra: {},
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

  describe('PAN-5360 schema fields', () => {
    it('parses created, status, supersedes and superseded_by', () => {
      const file = join(tmpRoot, 'mid-fact.md');
      const raw = [
        '---',
        'type: project',
        'description: A fact in the middle of a chain.',
        'created: 2026-11-01',
        'updated: 2026-11-10',
        'source: twitch:alice 2026-11-10 14:20',
        'status: superseded',
        'supersedes: [old-fact]',
        'superseded_by: new-fact',
        '---',
        '',
        'Body.',
        '',
      ].join('\n');
      const result = parseMemoryFact(file, raw, 'project');
      expect('reason' in result).toBe(false);
      const fact = result as MemoryFact;
      expect(fact.created).toBe('2026-11-01');
      expect(fact.status).toBe('superseded');
      expect(fact.supersedes).toEqual(['old-fact']);
      expect(fact.supersededBy).toBe('new-fact');
      expect(fact.source).toBe('twitch:alice 2026-11-10 14:20');
      expect(fact.extra).toEqual({});
    });

    it('rejects an invalid status, a non-id supersedes entry and a multi-line source as problems', () => {
      const dir = join(tmpRoot, 'memory');
      mkdirSync(dir, { recursive: true });
      const files: Record<string, string> = {
        'bad-status': '---\ntype: feedback\ndescription: x\nstatus: archived\n---\nbody\n',
        'bad-supersedes': '---\ntype: feedback\ndescription: x\nsupersedes: [Not An Id]\n---\nbody\n',
        'bad-superseded-by': '---\ntype: feedback\ndescription: x\nsuperseded_by: [a, b]\n---\nbody\n',
        'bad-source': '---\ntype: feedback\ndescription: x\nsource: "line one\\nline two"\n---\nbody\n',
        'long-source': `---\ntype: feedback\ndescription: x\nsource: ${'s'.repeat(MEMORY_FACT_DESCRIPTION_MAX + 1)}\n---\nbody\n`,
        'bad-created': '---\ntype: feedback\ndescription: x\ncreated: yesterday\n---\nbody\n',
        'good-fact': '---\ntype: feedback\ndescription: x\n---\nbody\n',
      };
      for (const [id, raw] of Object.entries(files)) writeFileSync(join(dir, `${id}.md`), raw, 'utf8');

      const { facts, problems } = readMemoryFactsSync(dir, 'project');
      expect(facts.map((fact) => fact.id)).toEqual(['good-fact']);
      const reasons = Object.fromEntries(problems.map((problem) => [problem.file.replace(`${dir}/`, ''), problem.reason]));
      expect(reasons).toEqual({
        'bad-status.md': 'invalid status "archived"',
        'bad-supersedes.md': 'supersedes must be a list of fact ids',
        'bad-superseded-by.md': 'invalid superseded_by',
        'bad-source.md': 'source must be one line of at most 200 characters',
        'long-source.md': 'source must be one line of at most 200 characters',
        'bad-created.md': 'invalid created date',
      });
    });

    it('a legacy fact without any new key parses as active and re-serializes byte-identical', () => {
      const file = join(tmpRoot, 'legacy-fact.md');
      const raw = '---\ntype: feedback\ndescription: A legacy fact.\ntags:\n  - workflow\nupdated: 2026-09-23\nsource: claude:abc\n---\n\nLegacy body.\n';
      const fact = parseMemoryFact(file, raw, 'project') as MemoryFact;
      expect(fact.status).toBe('active');
      expect(fact.created).toBeNull();
      expect(fact.supersedes).toEqual([]);
      expect(fact.supersededBy).toBeNull();
      expect(isActiveFact(fact)).toBe(true);
      expect(serializeMemoryFact(fact)).toBe(raw);
    });

    it('round-trips unknown frontmatter keys through parse and serialize', () => {
      const file = join(tmpRoot, 'extra-fact.md');
      const raw = '---\nowner: bob\ntype: feedback\ndescription: A fact with extra keys.\nweight: 3\n---\n\nBody.\n';
      const fact = parseMemoryFact(file, raw, 'project') as MemoryFact;
      expect(fact.extra).toEqual({ owner: 'bob', weight: 3 });
      const text = serializeMemoryFact(fact);
      expect(text).toBe('---\ntype: feedback\ndescription: A fact with extra keys.\nowner: bob\nweight: 3\n---\n\nBody.\n');
      const reparsed = parseMemoryFact(file, text, 'project') as MemoryFact;
      expect(reparsed.extra).toEqual({ owner: 'bob', weight: 3 });
    });

    it('writes status only when not active, and the new keys in D3 order', () => {
      const text = serializeMemoryFact({
        ...baseFact('ordered-new'),
        created: '2026-11-01',
        source: 'operator',
        status: 'superseded',
        supersedes: ['older'],
        supersededBy: 'newer',
        review: ['unindexed'],
        extra: { owner: 'bob' },
      });
      const keys = text
        .split('---')[1]
        .split('\n')
        .map((line) => line.match(/^(\w+):/)?.[1])
        .filter((key): key is string => Boolean(key));
      expect(keys).toEqual([
        'type', 'description', 'created', 'updated', 'source', 'status', 'supersedes', 'superseded_by', 'review', 'owner',
      ]);
      expect(serializeMemoryFact({ ...baseFact('active-one'), status: 'active' })).not.toContain('status:');
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

  describe('writeSupersedingFact', () => {
    const today = '2026-11-15';

    function readOne(dir: string, id: string): MemoryFact {
      const found = readMemoryFactsSync(dir, 'project').facts.find((entry) => entry.id === id);
      if (!found) throw new Error(`no fact ${id}`);
      return found;
    }

    it('marks the old fact superseded and links both ways without deleting it', async () => {
      const dir = join(tmpRoot, 'memory');
      await writeMemoryFact(dir, 'project', { ...baseFact('old-rule'), source: 'operator', extra: { owner: 'bob' } });

      const result = await writeSupersedingFact(dir, 'project', baseFact('new-rule'), ['old-rule'], { overwrite: false, today });
      expect(result).toEqual({ file: join(dir, 'new-rule.md'), supersededFiles: [join(dir, 'old-rule.md')] });

      const next = readOne(dir, 'new-rule');
      const old = readOne(dir, 'old-rule');
      expect(next.supersedes).toEqual(['old-rule']);
      expect(isActiveFact(next)).toBe(true);
      expect(old.status).toBe('superseded');
      expect(old.supersededBy).toBe('new-rule');
      expect(old.updated).toBe(today);
      expect(old.source).toBe('operator');
      expect(old.extra).toEqual({ owner: 'bob' });
      expect(old.body).toBe('Body text.');
      expect(isActiveFact(old)).toBe(false);
    });

    it('refuses a missing id, a self id and a fact superseded by another id, writing nothing', async () => {
      const dir = join(tmpRoot, 'memory');
      await writeMemoryFact(dir, 'project', baseFact('old-rule'));
      await writeMemoryFact(dir, 'project', { ...baseFact('taken-rule'), status: 'superseded', supersededBy: 'other-rule' });
      writeFileSync(join(dir, 'broken-rule.md'), '---\ntype: feedback\n---\nno description\n', 'utf8');
      const snapshot = () => Object.fromEntries(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name), 'utf8')]));
      const before = snapshot();
      const run = (ids: string[]) => writeSupersedingFact(dir, 'project', baseFact('new-rule'), ids, { overwrite: false, today });

      await expect(run(['missing-rule'])).rejects.toThrow(`no fact "missing-rule" in ${dir}`);
      await expect(run(['new-rule'])).rejects.toThrow('a fact cannot supersede itself');
      await expect(run(['old-rule', 'taken-rule'])).rejects.toThrow('"taken-rule" is already superseded by "other-rule"');
      await expect(run(['broken-rule'])).rejects.toThrow('fact "broken-rule" cannot be parsed (missing description); fix it first');
      await expect(run(['missing-rule'])).rejects.toBeInstanceOf(MemoryFactSupersedeError);

      expect(snapshot()).toEqual(before);
    });

    it('is idempotent when the old fact is already superseded by the same id', async () => {
      const dir = join(tmpRoot, 'memory');
      await writeMemoryFact(dir, 'project', baseFact('old-rule'));
      await writeSupersedingFact(dir, 'project', baseFact('new-rule'), ['old-rule'], { overwrite: false, today: '2026-11-01' });

      const oldBefore = readFileSync(join(dir, 'old-rule.md'), 'utf8');

      const again = await writeSupersedingFact(
        dir, 'project', readOne(dir, 'new-rule'), ['old-rule'], { overwrite: true, today },
      );
      expect(again.supersededFiles).toEqual([]);
      expect(readFileSync(join(dir, 'old-rule.md'), 'utf8')).toBe(oldBefore);
      expect(readOne(dir, 'new-rule').supersedes).toEqual(['old-rule']);
    });

    it("refuses before any write when the old fact's rewrite trips the secret scanner", async () => {
      const dir = join(tmpRoot, 'memory');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'old-rule.md'),
        '---\ntype: feedback\ndescription: Old rule.\n---\n\nKey is sk-ant-abcdef1234567890.\n',
        'utf8',
      );

      await expect(
        writeSupersedingFact(dir, 'project', baseFact('new-rule'), ['old-rule'], { overwrite: false, today }),
      ).rejects.toBeInstanceOf(MemoryFactSensitiveError);
      expect(existsSync(join(dir, 'new-rule.md'))).toBe(false);
      expect(readOne(dir, 'old-rule').status).toBe('active');
    });

    it('edit mode appends to an existing supersedes list without duplicates', async () => {
      const dir = join(tmpRoot, 'memory');
      await writeMemoryFact(dir, 'project', baseFact('rule-a'));
      await writeMemoryFact(dir, 'project', baseFact('rule-b'));
      await writeSupersedingFact(dir, 'project', baseFact('new-rule'), ['rule-a'], { overwrite: false, today });

      const existing = readOne(dir, 'new-rule');
      expect(existing.supersedes).toEqual(['rule-a']);
      await writeSupersedingFact(dir, 'project', existing, ['rule-b', 'rule-a'], { overwrite: true, today });

      expect(readOne(dir, 'new-rule').supersedes).toEqual(['rule-a', 'rule-b']);
      expect(readOne(dir, 'rule-b').supersededBy).toBe('new-rule');
    });

    it('refuses to edit a fact that is itself superseded', async () => {
      const dir = join(tmpRoot, 'memory');
      await writeMemoryFact(dir, 'project', baseFact('rule-a'));
      await writeMemoryFact(dir, 'project', baseFact('mid-rule'));
      await writeSupersedingFact(dir, 'project', baseFact('top-rule'), ['mid-rule'], { overwrite: false, today });

      await expect(
        writeSupersedingFact(dir, 'project', readOne(dir, 'mid-rule'), ['rule-a'], { overwrite: true, today }),
      ).rejects.toThrow('"mid-rule" is superseded by "top-rule"; edit that fact instead');
      expect(readOne(dir, 'rule-a').status).toBe('active');
    });

    it('refuses a new id that already exists when not overwriting', async () => {
      const dir = join(tmpRoot, 'memory');
      await writeMemoryFact(dir, 'project', baseFact('old-rule'));
      await writeMemoryFact(dir, 'project', baseFact('new-rule'));
      await expect(
        writeSupersedingFact(dir, 'project', baseFact('new-rule'), ['old-rule'], { overwrite: false, today }),
      ).rejects.toBeInstanceOf(MemoryFactExistsError);
      expect(readOne(dir, 'old-rule').status).toBe('active');
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
        created: null,
        updated: null,
        source: null,
        status: 'active',
        supersedes: [],
        supersededBy: null,
        review: [],
        extra: {},
        body: '',
        file: join(tmpRoot, 'x.md'),
      };
      expect(isActiveFact(fact)).toBe(true);
      expect(isActiveFact({ ...fact, review: ['unindexed'] })).toBe(false);
    });

    it('isActiveFact is false for superseded, retired, superseded_by-set and review-marked facts', () => {
      const fact = parseMemoryFact(join(tmpRoot, 'x.md'), '---\ntype: feedback\ndescription: d\n---\nbody\n', 'project') as MemoryFact;
      expect(isActiveFact(fact)).toBe(true);
      expect(isActiveFact({ ...fact, status: 'superseded', supersededBy: 'y' })).toBe(false);
      expect(isActiveFact({ ...fact, status: 'retired' })).toBe(false);
      expect(isActiveFact({ ...fact, supersededBy: 'y' })).toBe(false);
      expect(isActiveFact({ ...fact, review: ['sync-conflict'] })).toBe(false);
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
        created: null,
        updated: null,
        source: null,
        status: 'active',
        supersedes: [],
        supersededBy: null,
        review: [],
        extra: {},
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
