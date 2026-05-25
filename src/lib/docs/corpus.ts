import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, sep } from 'path';

import type { NormalizedDocsConfig } from '../config-yaml.js';
import { getDefaultDocsConfig } from '../config-yaml.js';
import { packageRoot, SYNC_SOURCES } from '../paths.js';

export type DocsDocKind = 'docs' | 'skill' | 'prd' | 'rule' | 'claude-md';

export interface DocsCorpusSource {
  absolutePath: string;
  relativePath: string;
  docKind: DocsDocKind;
}

export interface DocsChunk {
  docPath: string;
  docKind: DocsDocKind;
  sectionHeading: string | null;
  sectionAnchor: string | null;
  headingPath: string[];
  content: string;
  tokenCount: number;
}

export interface DocsCorpusOptions {
  rootDir?: string;
  syncSourcesRoot?: string;
  config?: Pick<NormalizedDocsConfig, 'corpus'>;
}

export interface ChunkMarkdownOptions {
  maxChunkTokens?: number;
}

interface HeadingState {
  level: number;
  text: string;
  anchor: string;
}

interface MarkdownSection {
  headingPath: string[];
  sectionHeading: string | null;
  sectionAnchor: string | null;
  content: string;
}

const GENERATED_OR_IRRELEVANT_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
  'graphify-out',
]);

const DEFAULT_DOCS_CONFIG = getDefaultDocsConfig();

function corpusConfig(config?: Pick<NormalizedDocsConfig, 'corpus'>): NormalizedDocsConfig['corpus'] {
  return config?.corpus ?? DEFAULT_DOCS_CONFIG.corpus;
}

export async function discoverDocsCorpusSources(options: DocsCorpusOptions = {}): Promise<DocsCorpusSource[]> {
  const rootDir = options.rootDir ?? packageRoot;
  const syncSourcesRoot = options.syncSourcesRoot ?? SYNC_SOURCES.root;
  const corpus = corpusConfig(options.config);
  const sources: DocsCorpusSource[] = [];

  if (corpus.docs) {
    sources.push(...await discoverMarkdownUnder(join(rootDir, 'docs'), rootDir, 'docs', {
      excludeRelativePrefixes: ['docs/prds/'],
    }));
  }

  if (corpus.skills) {
    sources.push(...await discoverSkillSources(join(syncSourcesRoot, 'skills'), rootDir));
  }

  if (corpus.rules) {
    sources.push(...await discoverMarkdownUnder(join(syncSourcesRoot, 'rules'), rootDir, 'rule'));
    sources.push(...await discoverMarkdownUnder(join(rootDir, '.claude', 'rules'), rootDir, 'rule'));
  }

  if (corpus.claudeMd) {
    const claudeMd = join(rootDir, 'CLAUDE.md');
    if (await pathExists(claudeMd)) {
      sources.push(sourceFor(claudeMd, rootDir, 'claude-md'));
    }
  }

  if (corpus.prds) {
    for (const status of corpus.prdStatuses) {
      sources.push(...await discoverMarkdownUnder(join(rootDir, 'docs', 'prds', status), rootDir, 'prd'));
    }
  }

  return dedupeSources(sources).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function loadDocsCorpus(options: DocsCorpusOptions = {}): Promise<DocsChunk[]> {
  const sources = await discoverDocsCorpusSources(options);
  const maxChunkTokens = corpusConfig(options.config).maxChunkTokens;
  const chunks: DocsChunk[] = [];

  for (const source of sources) {
    const markdown = await readFile(source.absolutePath, 'utf8');
    chunks.push(...chunkMarkdown(source, markdown, { maxChunkTokens }));
  }

  return chunks;
}

export function chunkMarkdown(
  source: Pick<DocsCorpusSource, 'relativePath' | 'docKind'>,
  markdown: string,
  options: ChunkMarkdownOptions = {},
): DocsChunk[] {
  const maxChunkTokens = options.maxChunkTokens ?? DEFAULT_DOCS_CONFIG.corpus.maxChunkTokens;
  const stripped = stripFrontmatter(markdown).trim();
  if (!stripped) return [];

  const sections = splitMarkdownSections(stripped);
  return sections.flatMap((section) => splitSectionIntoChunks(source, section, maxChunkTokens));
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function headingAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  const stack: HeadingState[] = [];
  const anchorCounts = new Map<string, number>();
  let current: MarkdownSection = {
    headingPath: [],
    sectionHeading: null,
    sectionAnchor: null,
    content: '',
  };
  let currentLines: string[] = [];
  let inFence = false;

  const flush = () => {
    const content = currentLines.join('\n').trim();
    if (content) sections.push({ ...current, content });
  };

  for (const line of lines) {
    if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
      inFence = !inFence;
    }

    const headingMatch = inFence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (headingMatch) {
      flush();
      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();
      const baseAnchor = headingAnchor(heading);
      const anchorSeenCount = anchorCounts.get(baseAnchor) ?? 0;
      anchorCounts.set(baseAnchor, anchorSeenCount + 1);
      const anchor = anchorSeenCount === 0 ? baseAnchor : `${baseAnchor}-${anchorSeenCount}`;

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack.push({ level, text: heading, anchor });

      current = {
        headingPath: stack.map((item) => item.text),
        sectionHeading: heading,
        sectionAnchor: anchor,
        content: '',
      };
      currentLines = [line];
      continue;
    }

    currentLines.push(line);
  }

  flush();
  return sections;
}

function splitSectionIntoChunks(
  source: Pick<DocsCorpusSource, 'relativePath' | 'docKind'>,
  section: MarkdownSection,
  maxChunkTokens: number,
): DocsChunk[] {
  const content = section.content.trim();
  if (estimateTokens(content) <= maxChunkTokens) {
    return [chunkFor(source, section, content)];
  }

  const [firstLine, ...restLines] = content.split('\n');
  const headingPrefix = section.sectionHeading && /^#{1,6}\s+/.test(firstLine) ? firstLine : '';
  const body = headingPrefix ? restLines.join('\n') : content;
  return splitTextWithPrefix(body, headingPrefix, maxChunkTokens).map((part) => chunkFor(source, section, part));
}

function splitTextWithPrefix(body: string, prefix: string, maxChunkTokens: number): string[] {
  const chunks: string[] = [];
  const prefixTokens = estimateTokens(prefix);
  const bodyBudget = Math.max(1, maxChunkTokens - prefixTokens);
  let currentWords: string[] = [];

  const flush = () => {
    if (currentWords.length === 0) return;
    chunks.push([prefix, currentWords.join(' ')].filter(Boolean).join('\n').trim());
    currentWords = [];
  };

  for (const word of body.trim().split(/\s+/).filter(Boolean)) {
    if (currentWords.length >= bodyBudget) flush();
    currentWords.push(word);
  }
  flush();

  if (chunks.length === 0 && prefix) return [prefix];
  return chunks;
}

function chunkFor(
  source: Pick<DocsCorpusSource, 'relativePath' | 'docKind'>,
  section: MarkdownSection,
  content: string,
): DocsChunk {
  return {
    docPath: source.relativePath,
    docKind: source.docKind,
    sectionHeading: section.sectionHeading,
    sectionAnchor: section.sectionAnchor,
    headingPath: [...section.headingPath],
    content,
    tokenCount: estimateTokens(content),
  };
}

async function discoverSkillSources(skillsDir: string, rootDir: string): Promise<DocsCorpusSource[]> {
  const entries = await safeReaddir(skillsDir);
  const sources: DocsCorpusSource[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsDir, entry.name, 'SKILL.md');
    if (await pathExists(skillPath)) {
      sources.push(sourceFor(skillPath, rootDir, 'skill'));
    }
  }
  return sources;
}

async function discoverMarkdownUnder(
  dir: string,
  rootDir: string,
  docKind: DocsDocKind,
  options: { excludeRelativePrefixes?: string[] } = {},
): Promise<DocsCorpusSource[]> {
  const entries = await safeReaddir(dir);
  const sources: DocsCorpusSource[] = [];

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    if (shouldSkipPath(absolutePath)) continue;
    if (entry.isDirectory()) {
      sources.push(...await discoverMarkdownUnder(absolutePath, rootDir, docKind, options));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const source = sourceFor(absolutePath, rootDir, docKind);
    if (options.excludeRelativePrefixes?.some((prefix) => source.relativePath.startsWith(prefix))) continue;
    sources.push(source);
  }

  return sources;
}

function sourceFor(absolutePath: string, rootDir: string, docKind: DocsDocKind): DocsCorpusSource {
  return {
    absolutePath,
    relativePath: toPosixPath(relative(rootDir, absolutePath)),
    docKind,
  };
}

function dedupeSources(sources: DocsCorpusSource[]): DocsCorpusSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.absolutePath)) return false;
    seen.add(source.absolutePath);
    return true;
  });
}

function shouldSkipPath(filePath: string): boolean {
  return filePath.split(sep).some((segment) => GENERATED_OR_IRRELEVANT_SEGMENTS.has(segment));
}

function toPosixPath(filePath: string): string {
  return filePath.split(sep).join('/');
}

async function safeReaddir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}
