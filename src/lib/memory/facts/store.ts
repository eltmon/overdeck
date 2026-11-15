/**
 * Curated memory facts (PAN-3957): one markdown file per fact with OKF-compatible
 * frontmatter. Project facts live in `<planHome>/.overdeck/memory/`, operator facts
 * in `~/.overdeck/context/memory/` (synced across machines, PAN-4578), and
 * machine facts in `~/.overdeck/context/machine-memory/` (never synced). Nothing
 * here stores an index: the index is rendered from frontmatter at launch (render.ts).
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
export type MemoryFactScope = 'project' | 'user' | 'machine';
export const MEMORY_FACT_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const MEMORY_FACT_DESCRIPTION_MAX = 200;
// PAN-3957 D16 / PAN-4578 D3: a home-directory path cannot be true on another
// machine, so it never belongs in the project or operator store.
export const MACHINE_PATH_PATTERN = /\/home\/[^/\s]+\/|\/Users\/[^/\s]+\/|\b[A-Za-z]:\\Users\\/;
// PAN-5360: a superseded or retired fact stays on disk but leaves every injection.
export const MEMORY_FACT_STATUSES = ['active', 'superseded', 'retired'] as const;
export type MemoryFactStatus = (typeof MEMORY_FACT_STATUSES)[number];
const KNOWN_FRONTMATTER_KEYS: readonly string[] = [
  'type', 'title', 'description', 'tags', 'created', 'updated', 'source', 'status', 'supersedes', 'superseded_by', 'review',
];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface MemoryFact {
  readonly id: string;
  readonly scope: MemoryFactScope;
  readonly type: MemoryFactType;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly created: string | null; // YYYY-MM-DD
  readonly updated: string | null; // YYYY-MM-DD
  readonly source: string | null;
  readonly status: MemoryFactStatus; // 'active' when the key is absent
  readonly supersedes: readonly string[];
  readonly supersededBy: string | null; // frontmatter key: superseded_by
  readonly review: readonly string[];
  /** Frontmatter keys this module does not know, preserved verbatim in parsed order. */
  readonly extra: Readonly<Record<string, unknown>>;
  readonly body: string;
  readonly file: string; // absolute
}

/** Write input: the new fields are optional and default to an active, unlinked fact. */
export type MemoryFactInput = Omit<MemoryFact, 'file' | 'scope' | 'created' | 'status' | 'supersedes' | 'supersededBy' | 'extra'>
  & Partial<Pick<MemoryFact, 'created' | 'status' | 'supersedes' | 'supersededBy' | 'extra'>>;

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

/** PAN-4578: per-machine facts (local paths, hardware); never synced. */
export function machineMemoryDir(): string {
  return join(getOverdeckHome(), 'context', 'machine-memory');
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
    if (!DATE_PATTERN.test(updatedText)) return { file, reason: 'invalid updated date' };
    updated = updatedText;
  }

  let created: string | null = null;
  if (frontmatter.created !== undefined && frontmatter.created !== null) {
    const createdText = String(frontmatter.created);
    if (!DATE_PATTERN.test(createdText)) return { file, reason: 'invalid created date' };
    created = createdText;
  }

  let status: MemoryFactStatus = 'active';
  if (frontmatter.status !== undefined && frontmatter.status !== null) {
    const rawStatus = frontmatter.status;
    if (typeof rawStatus !== 'string' || !(MEMORY_FACT_STATUSES as readonly string[]).includes(rawStatus)) {
      return { file, reason: `invalid status "${String(rawStatus)}"` };
    }
    status = rawStatus as MemoryFactStatus;
  }

  let supersedes: string[] = [];
  if (frontmatter.supersedes !== undefined && frontmatter.supersedes !== null) {
    if (!isStringArray(frontmatter.supersedes) || !frontmatter.supersedes.every((entry) => MEMORY_FACT_ID.test(entry))) {
      return { file, reason: 'supersedes must be a list of fact ids' };
    }
    supersedes = frontmatter.supersedes;
  }

  let supersededBy: string | null = null;
  if (frontmatter.superseded_by !== undefined && frontmatter.superseded_by !== null) {
    if (typeof frontmatter.superseded_by !== 'string' || !MEMORY_FACT_ID.test(frontmatter.superseded_by)) {
      return { file, reason: 'invalid superseded_by' };
    }
    supersededBy = frontmatter.superseded_by;
  }

  const source = typeof frontmatter.source === 'string' ? frontmatter.source : null;
  if (source !== null && (source.includes('\n') || source.length > MEMORY_FACT_DESCRIPTION_MAX)) {
    return { file, reason: 'source must be one line of at most 200 characters' };
  }

  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(frontmatter)) {
    if (!KNOWN_FRONTMATTER_KEYS.includes(key)) extra[key] = frontmatter[key];
  }

  const title = typeof frontmatter.title === 'string' ? frontmatter.title : defaultFactTitle(id);
  const body = raw.slice(frontmatterMatch[0].length).trim();

  if (scope === 'project' || scope === 'user') {
    const haystack = [title, description, ...tags, body].join('\n');
    const machineMatch = haystack.match(MACHINE_PATH_PATTERN);
    if (machineMatch) {
      return {
        file,
        reason: `machine-specific path "${machineMatch[0]}"; use ~ or a relative path, or keep the fact on this machine with --machine`,
      };
    }
  }

  return {
    id, scope, type, title, description, tags, created, updated, source, status, supersedes, supersededBy, review, extra, body, file,
  };
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

/** PAN-5360 D3: known keys in a fixed order, `status` only when not active, then unknown keys in parsed order. */
export function serializeMemoryFact(fact: MemoryFactInput): string {
  const frontmatter: Record<string, unknown> = { type: fact.type };
  if (fact.title !== defaultFactTitle(fact.id)) frontmatter.title = fact.title;
  frontmatter.description = fact.description;
  if (fact.tags.length > 0) frontmatter.tags = fact.tags;
  if (fact.created != null) frontmatter.created = fact.created;
  if (fact.updated !== null) frontmatter.updated = fact.updated;
  if (fact.source !== null) frontmatter.source = fact.source;
  if (fact.status !== undefined && fact.status !== 'active') frontmatter.status = fact.status;
  if (fact.supersedes && fact.supersedes.length > 0) frontmatter.supersedes = fact.supersedes;
  if (fact.supersededBy != null) frontmatter.superseded_by = fact.supersededBy;
  if (fact.review.length > 0) frontmatter.review = fact.review;
  for (const [key, value] of Object.entries(fact.extra ?? {})) {
    if (!KNOWN_FRONTMATTER_KEYS.includes(key)) frontmatter[key] = value;
  }

  const yamlText = stringifyYaml(frontmatter).trimEnd();
  return `---\n${yamlText}\n---\n\n${fact.body}\n`;
}

/** Serialize `fact` and check it would parse and carries no secret-like text; throws before any write. */
function prepareFactText(dir: string, scope: MemoryFactScope, fact: MemoryFactInput): { file: string; text: string } {
  const file = join(dir, `${fact.id}.md`);
  const text = serializeMemoryFact(fact);

  const parsed = parseMemoryFact(file, text, scope);
  if (isMemoryFactProblem(parsed)) throw new Error(parsed.reason);

  if (redactSensitiveText(text) !== text) {
    throw new MemoryFactSensitiveError('fact contains secret-like content; rephrase it');
  }
  return { file, text };
}

async function writeFactFile(dir: string, file: string, text: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmpFile = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmpFile, text, 'utf8');
  await rename(tmpFile, file);
}

export async function writeMemoryFact(
  dir: string,
  scope: MemoryFactScope,
  fact: MemoryFactInput,
  opts?: { overwrite?: boolean },
): Promise<string> {
  const { file, text } = prepareFactText(dir, scope, fact);

  if (!opts?.overwrite && existsSync(file)) {
    throw new MemoryFactExistsError(`fact "${fact.id}" already exists at ${file}`);
  }

  await writeFactFile(dir, file, text);
  return file;
}

export class MemoryFactSupersedeError extends Error {}

/**
 * Write `fact` and mark each id in `supersedes` superseded by it (PAN-5360 D4-D6, D11).
 * Every id must name a parseable fact in `dir` (the same store). Validates every file
 * before writing any; writes the new fact first, then each old fact. An old fact already
 * superseded by `fact.id` is left as it is, so a repeat is a no-op for it.
 */
export async function writeSupersedingFact(
  dir: string,
  scope: MemoryFactScope,
  fact: MemoryFactInput,
  supersedes: readonly string[],
  opts: { overwrite: boolean; today: string },
): Promise<{ file: string; supersededFiles: string[] }> {
  const { facts, problems } = readMemoryFactsSync(dir, scope);
  const byId = new Map(facts.map((entry) => [entry.id, entry]));
  const problemByFile = new Map(problems.map((problem) => [problem.file, problem.reason]));

  if (opts.overwrite) {
    const existing = byId.get(fact.id);
    if (existing?.supersededBy) {
      throw new MemoryFactSupersedeError(`"${fact.id}" is superseded by "${existing.supersededBy}"; edit that fact instead`);
    }
  }

  const ids = [...new Set(supersedes)];
  const toRewrite: MemoryFact[] = [];
  for (const id of ids) {
    if (id === fact.id) throw new MemoryFactSupersedeError('a fact cannot supersede itself');
    const problemReason = problemByFile.get(join(dir, `${id}.md`));
    if (problemReason !== undefined) {
      throw new MemoryFactSupersedeError(`fact "${id}" cannot be parsed (${problemReason}); fix it first`);
    }
    const old = byId.get(id);
    if (!old) throw new MemoryFactSupersedeError(`no fact "${id}" in ${dir}`);
    if (old.supersededBy !== null && old.supersededBy !== fact.id) {
      throw new MemoryFactSupersedeError(`"${id}" is already superseded by "${old.supersededBy}"`);
    }
    if (old.supersededBy !== fact.id) toRewrite.push(old);
  }

  const next = prepareFactText(dir, scope, {
    ...fact,
    supersedes: [...new Set([...(fact.supersedes ?? []), ...ids])],
  });
  const olds = toRewrite.map((old) => prepareFactText(dir, scope, {
    ...old,
    status: 'superseded',
    supersededBy: fact.id,
    updated: opts.today,
  }));

  if (!opts.overwrite && existsSync(next.file)) {
    throw new MemoryFactExistsError(`fact "${fact.id}" already exists at ${next.file}`);
  }

  await writeFactFile(dir, next.file, next.text);
  const supersededFiles: string[] = [];
  for (const old of olds) {
    try {
      await writeFactFile(dir, old.file, old.text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`wrote ${[next.file, ...supersededFiles].join(', ')}; failed writing ${old.file}: ${message}`);
    }
    supersededFiles.push(old.file);
  }
  return { file: next.file, supersededFiles };
}

export async function removeMemoryFact(dir: string, id: string): Promise<string> {
  const file = join(dir, `${id}.md`);
  if (!existsSync(file)) throw new Error(`no fact "${id}" in ${dir}`);
  await unlink(file);
  return file;
}

/** PAN-5360 D2: `superseded_by` makes a fact inactive even when `status` still says active. */
export function isActiveFact(fact: MemoryFact): boolean {
  return fact.status === 'active' && fact.supersededBy === null && fact.review.length === 0;
}

export function matchMemoryFacts(facts: readonly MemoryFact[], query: string): MemoryFact[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...facts];
  return facts.filter((fact) => {
    const haystack = [fact.id, fact.title, fact.description, ...fact.tags, fact.body].join('\n').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
