/**
 * Curated memory facts (PAN-3957): one markdown file per fact with OKF-compatible
 * frontmatter. Project facts live in `<planHome>/.overdeck/memory/`, operator facts
 * in `~/.overdeck/context/memory/`. Nothing here stores an index: the index is
 * rendered from frontmatter at launch (render.ts).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getOverdeckHome } from '../../paths.js';
import { resolvePlanHome } from '../../pan-dir/paths.js';
import { redactSensitiveText } from '../../secret-redaction.js';

export const MEMORY_FACT_TYPES = ['feedback', 'project', 'reference', 'user'] as const;
export type MemoryFactType = (typeof MEMORY_FACT_TYPES)[number];
export type MemoryFactScope = 'project' | 'user';
export const MEMORY_FACT_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const MEMORY_FACT_DESCRIPTION_MAX = 200;
// PAN-3957 D16: a home-directory path cannot be true on another machine, so it
// never belongs in the project store.
export const MACHINE_PATH_PATTERN = /\/home\/[^/\s]+\/|\/Users\/[^/\s]+\/|\b[A-Za-z]:\\Users\\/;

export interface MemoryFact {
  readonly id: string;
  readonly scope: MemoryFactScope;
  readonly type: MemoryFactType;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly updated: string | null; // YYYY-MM-DD
  readonly source: string | null;
  readonly review: readonly string[];
  readonly body: string;
  readonly file: string; // absolute
}

export interface MemoryFactProblem {
  readonly file: string;
  readonly reason: string;
}

export interface MemoryFactReadResult {
  readonly facts: MemoryFact[];
  readonly problems: MemoryFactProblem[];
}

export class MemoryFactSensitiveError extends Error {}
export class MemoryFactExistsError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isMemoryFactProblem(result: MemoryFact | MemoryFactProblem): result is MemoryFactProblem {
  return 'reason' in result;
}

export function projectMemoryDir(checkoutPath: string): string {
  return join(resolvePlanHome(checkoutPath), '.overdeck', 'memory');
}

export function userMemoryDir(): string {
  return join(getOverdeckHome(), 'context', 'memory');
}

export function defaultFactTitle(id: string): string {
  const words = id.split('-').join(' ');
  return words.length > 0 ? `${words[0].toUpperCase()}${words.slice(1)}` : words;
}

export function parseMemoryFact(file: string, raw: string, scope: MemoryFactScope): MemoryFact | MemoryFactProblem {
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontmatterMatch) return { file, reason: 'no frontmatter' };

  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(frontmatterMatch[1]);
  } catch {
    return { file, reason: 'invalid frontmatter' };
  }
  if (!isRecord(frontmatter)) return { file, reason: 'invalid frontmatter' };

  const stem = basename(file).replace(/\.md$/, '');
  if (!MEMORY_FACT_ID.test(stem)) return { file, reason: `invalid id "${stem}"` };
  const id = stem;

  const rawType = frontmatter.type;
  if (typeof rawType !== 'string' || !(MEMORY_FACT_TYPES as readonly string[]).includes(rawType)) {
    return { file, reason: `invalid type "${String(rawType)}"` };
  }
  const type = rawType as MemoryFactType;

  if (scope === 'project' && type === 'user') {
    return { file, reason: 'user facts belong in the operator store (~/.overdeck/context/memory)' };
  }

  const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';
  if (!description) return { file, reason: 'missing description' };
  if (description.includes('\n')) return { file, reason: 'description must be one line' };
  if (description.length > MEMORY_FACT_DESCRIPTION_MAX) return { file, reason: 'description exceeds 200 characters' };

  let tags: string[] = [];
  if (frontmatter.tags !== undefined) {
    if (!isStringArray(frontmatter.tags)) return { file, reason: 'tags must be a list of strings' };
    tags = frontmatter.tags;
  }

  let review: string[] = [];
  if (frontmatter.review !== undefined) {
    if (!isStringArray(frontmatter.review)) return { file, reason: 'review must be a list of strings' };
    review = frontmatter.review;
  }

  let updated: string | null = null;
  if (frontmatter.updated !== undefined && frontmatter.updated !== null) {
    const updatedText = String(frontmatter.updated);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedText)) return { file, reason: 'invalid updated date' };
    updated = updatedText;
  }

  const source = typeof frontmatter.source === 'string' ? frontmatter.source : null;
  const title = typeof frontmatter.title === 'string' ? frontmatter.title : defaultFactTitle(id);
  const body = raw.slice(frontmatterMatch[0].length).trim();

  if (scope === 'project') {
    const haystack = [title, description, ...tags, body].join('\n');
    const machineMatch = haystack.match(MACHINE_PATH_PATTERN);
    if (machineMatch) {
      return {
        file,
        reason: `machine-specific path "${machineMatch[0]}"; use ~ or a project-relative path, or keep the fact on this machine with --user`,
      };
    }
  }

  return { id, scope, type, title, description, tags, updated, source, review, body, file };
}

export function readMemoryFactsSync(dir: string, scope: MemoryFactScope): MemoryFactReadResult {
  if (!existsSync(dir)) return { facts: [], problems: [] };

  const facts: MemoryFact[] = [];
  const problems: MemoryFactProblem[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.') || entry.name === 'README.md' || !entry.name.endsWith('.md')) {
      continue;
    }
    const file = join(dir, entry.name);
    const result = parseMemoryFact(file, readFileSync(file, 'utf8'), scope);
    if (isMemoryFactProblem(result)) problems.push(result);
    else facts.push(result);
  }
  facts.sort((a, b) => a.id.localeCompare(b.id));
  return { facts, problems };
}

export function serializeMemoryFact(fact: Omit<MemoryFact, 'file' | 'scope'>): string {
  const frontmatter: Record<string, unknown> = { type: fact.type };
  if (fact.title !== defaultFactTitle(fact.id)) frontmatter.title = fact.title;
  frontmatter.description = fact.description;
  if (fact.tags.length > 0) frontmatter.tags = fact.tags;
  if (fact.updated !== null) frontmatter.updated = fact.updated;
  if (fact.source !== null) frontmatter.source = fact.source;
  if (fact.review.length > 0) frontmatter.review = fact.review;

  const yamlText = stringifyYaml(frontmatter).trimEnd();
  return `---\n${yamlText}\n---\n\n${fact.body}\n`;
}

export async function writeMemoryFact(
  dir: string,
  scope: MemoryFactScope,
  fact: Omit<MemoryFact, 'file' | 'scope'>,
  opts?: { overwrite?: boolean },
): Promise<string> {
  const file = join(dir, `${fact.id}.md`);
  const text = serializeMemoryFact(fact);

  const parsed = parseMemoryFact(file, text, scope);
  if (isMemoryFactProblem(parsed)) throw new Error(parsed.reason);

  if (redactSensitiveText(text) !== text) {
    throw new MemoryFactSensitiveError('fact contains secret-like content; rephrase it');
  }

  if (!opts?.overwrite && existsSync(file)) {
    throw new MemoryFactExistsError(`fact "${fact.id}" already exists at ${file}`);
  }

  await mkdir(dir, { recursive: true });
  const tmpFile = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmpFile, text, 'utf8');
  await rename(tmpFile, file);
  return file;
}

export async function removeMemoryFact(dir: string, id: string): Promise<string> {
  const file = join(dir, `${id}.md`);
  if (!existsSync(file)) throw new Error(`no fact "${id}" in ${dir}`);
  await unlink(file);
  return file;
}

export function isActiveFact(fact: MemoryFact): boolean {
  return fact.review.length === 0;
}

export function matchMemoryFacts(facts: readonly MemoryFact[], query: string): MemoryFact[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...facts];
  return facts.filter((fact) => {
    const haystack = [fact.id, fact.title, fact.description, ...fact.tags, fact.body].join('\n').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
