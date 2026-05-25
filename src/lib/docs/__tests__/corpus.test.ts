import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  chunkMarkdown,
  discoverDocsCorpusSources,
  headingAnchor,
  loadDocsCorpus,
  type DocsCorpusSource,
} from '../corpus.js';
import { getDefaultDocsConfig, type NormalizedDocsConfig } from '../../config-yaml.js';

let rootDir: string;
let syncSourcesRoot: string;

async function writeFixture(path: string, content: string): Promise<void> {
  await mkdir(join(rootDir, path, '..'), { recursive: true });
  await writeFile(join(rootDir, path), content, 'utf8');
}

async function writeSyncFixture(path: string, content: string): Promise<void> {
  await mkdir(join(syncSourcesRoot, path, '..'), { recursive: true });
  await writeFile(join(syncSourcesRoot, path), content, 'utf8');
}

function docsConfig(corpus: Partial<NormalizedDocsConfig['corpus']>): Pick<NormalizedDocsConfig, 'corpus'> {
  return {
    corpus: {
      ...getDefaultDocsConfig().corpus,
      ...corpus,
    },
  };
}

function source(relativePath = 'docs/example.md', docKind: DocsCorpusSource['docKind'] = 'docs') {
  return { relativePath, docKind };
}

describe('docs corpus discovery', () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'pan-docs-corpus-'));
    syncSourcesRoot = join(rootDir, 'sync-sources');
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('discovers docs, skills, global and project rules, CLAUDE.md, and optional PRDs with doc kinds', async () => {
    await writeFixture('docs/USAGE.md', '# Usage\n');
    await writeFixture('docs/prds/planned/PAN-1.md', '# Planned PRD\n');
    await writeFixture('docs/prds/completed/PAN-2.md', '# Completed PRD\n');
    await writeFixture('.claude/rules/project-rule.md', '# Project Rule\n');
    await writeFixture('CLAUDE.md', '# Claude Rules\n');
    await writeSyncFixture('skills/pan-sync/SKILL.md', '# pan-sync\n');
    await writeSyncFixture('rules/global-rule.md', '# Global Rule\n');

    const defaultSources = await discoverDocsCorpusSources({ rootDir, syncSourcesRoot });

    expect(defaultSources.map((item) => [item.relativePath, item.docKind])).toEqual([
      ['.claude/rules/project-rule.md', 'rule'],
      ['CLAUDE.md', 'claude-md'],
      ['docs/USAGE.md', 'docs'],
      ['sync-sources/rules/global-rule.md', 'rule'],
      ['sync-sources/skills/pan-sync/SKILL.md', 'skill'],
    ]);

    const withPrds = await discoverDocsCorpusSources({
      rootDir,
      syncSourcesRoot,
      config: docsConfig({ prds: true, prdStatuses: ['planned'] }),
    });

    expect(withPrds.map((item) => [item.relativePath, item.docKind])).toContainEqual([
      'docs/prds/planned/PAN-1.md',
      'prd',
    ]);
    expect(withPrds.map((item) => item.relativePath)).not.toContain('docs/prds/completed/PAN-2.md');
  });

  it('loads skill documents into chunks with skill doc kind', async () => {
    await writeSyncFixture('skills/pan-sync/SKILL.md', '# pan-sync\n\nUse `pan sync`.\n');

    const chunks = await loadDocsCorpus({
      rootDir,
      syncSourcesRoot,
      config: docsConfig({ docs: false, rules: false, claudeMd: false, skills: true }),
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      docPath: 'sync-sources/skills/pan-sync/SKILL.md',
      docKind: 'skill',
      sectionHeading: 'pan-sync',
      sectionAnchor: 'pan-sync',
      headingPath: ['pan-sync'],
    });
    expect(chunks[0].content).toContain('Use `pan sync`.');
  });
});

describe('markdown chunking', () => {
  it('preserves nested heading paths and anchors', () => {
    const chunks = chunkMarkdown(source(), `# Top Level\n\nIntro.\n\n## Child Heading!\n\nChild body.\n\n### Grand Child\n\nDeep body.`);

    expect(chunks.map((chunk) => ({
      heading: chunk.sectionHeading,
      anchor: chunk.sectionAnchor,
      path: chunk.headingPath,
      content: chunk.content,
    }))).toEqual([
      {
        heading: 'Top Level',
        anchor: 'top-level',
        path: ['Top Level'],
        content: '# Top Level\n\nIntro.',
      },
      {
        heading: 'Child Heading!',
        anchor: 'child-heading',
        path: ['Top Level', 'Child Heading!'],
        content: '## Child Heading!\n\nChild body.',
      },
      {
        heading: 'Grand Child',
        anchor: 'grand-child',
        path: ['Top Level', 'Child Heading!', 'Grand Child'],
        content: '### Grand Child\n\nDeep body.',
      },
    ]);
  });

  it('returns no chunks for empty files', () => {
    expect(chunkMarkdown(source(), '\n\n')).toEqual([]);
  });

  it('splits large sections to the configured token budget', () => {
    const body = Array.from({ length: 23 }, (_, index) => `word${index}`).join(' ');
    const chunks = chunkMarkdown(source(), `# Large\n\n${body}`, { maxChunkTokens: 10 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.tokenCount <= 10)).toBe(true);
    expect(chunks.every((chunk) => chunk.headingPath.join(' > ') === 'Large')).toBe(true);
    expect(chunks.every((chunk) => chunk.content.startsWith('# Large'))).toBe(true);
  });

  it('strips rule frontmatter before chunking', () => {
    const chunks = chunkMarkdown(source('.claude/rules/project-rule.md', 'rule'), `---\nname: project-rule\ndescription: Hidden metadata\n---\n# Rule Title\n\nVisible rule body.`);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('# Rule Title\n\nVisible rule body.');
    expect(chunks[0].content).not.toContain('Hidden metadata');
    expect(chunks[0]).toMatchObject({
      docKind: 'rule',
      sectionHeading: 'Rule Title',
      sectionAnchor: 'rule-title',
      headingPath: ['Rule Title'],
    });
  });

  it('generates stable anchors for punctuation and duplicate headings', () => {
    const chunks = chunkMarkdown(source(), '## Install & Run?\n\nFirst.\n\n## Install & Run?\n\nSecond.');

    expect(headingAnchor('Install & Run?')).toBe('install-run');
    expect(chunks.map((chunk) => chunk.sectionAnchor)).toEqual(['install-run', 'install-run-1']);
  });
});
