import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Mustache from 'mustache';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

Mustache.escape = (text: unknown) => String(text);

let resolvedPromptsDir: string | null = null;

function resolvePromptsDir(): string {
  if (resolvedPromptsDir) return resolvedPromptsDir;

  const direct = join(__dirname, 'prompts');
  if (existsSync(direct)) {
    resolvedPromptsDir = direct;
    return resolvedPromptsDir;
  }

  let packageRoot = __dirname;
  if (packageRoot.includes('/src/')) {
    packageRoot = packageRoot.replace(/\/src\/.*$/, '');
  } else {
    packageRoot = join(packageRoot, '..', '..');
  }
  const fromRoot = join(packageRoot, 'src', 'lib', 'cloister', 'prompts');
  if (existsSync(fromRoot)) {
    resolvedPromptsDir = fromRoot;
    return resolvedPromptsDir;
  }

  resolvedPromptsDir = direct;
  return resolvedPromptsDir;
}

export interface PromptFrontmatter {
  name: string;
  description: string;
  requires: string[];
  optional: string[];
}

interface ParsedPrompt {
  frontmatter: PromptFrontmatter;
  body: string;
  path: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export class PromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptError';
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function parsePrompt(name: string): ParsedPrompt {
  const path = join(resolvePromptsDir(), `${name}.md`);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (e) {
    throw new PromptError(
      `Failed to load prompt template "${name}" from ${path}: ${(e as Error).message}`
    );
  }

  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    throw new PromptError(
      `Prompt template "${name}" at ${path} is missing YAML frontmatter ` +
        `(expected "---\\n<yaml>\\n---\\n<body>" header).`
    );
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(match[1]);
  } catch (e) {
    throw new PromptError(
      `Prompt template "${name}" has invalid YAML frontmatter: ${(e as Error).message}`
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new PromptError(`Prompt template "${name}" frontmatter must be a YAML mapping.`);
  }
  const fm = parsed as Record<string, unknown>;

  if (typeof fm.name !== 'string' || !fm.name) {
    throw new PromptError(
      `Prompt template "${name}" frontmatter is missing required field "name".`
    );
  }
  if (typeof fm.description !== 'string' || !fm.description) {
    throw new PromptError(
      `Prompt template "${name}" frontmatter is missing required field "description".`
    );
  }
  if (fm.requires !== undefined && !isStringArray(fm.requires)) {
    throw new PromptError(
      `Prompt template "${name}" frontmatter "requires" must be a list of strings.`
    );
  }
  if (fm.optional !== undefined && !isStringArray(fm.optional)) {
    throw new PromptError(
      `Prompt template "${name}" frontmatter "optional" must be a list of strings.`
    );
  }

  const frontmatter: PromptFrontmatter = {
    name: fm.name,
    description: fm.description,
    requires: (fm.requires as string[] | undefined) ?? [],
    optional: (fm.optional as string[] | undefined) ?? [],
  };

  return { frontmatter, body: match[2], path };
}

export interface RenderPromptOptions {
  name: string;
  vars: Record<string, unknown>;
}

export function renderPrompt({ name, vars }: RenderPromptOptions): string {
  const { frontmatter, body, path } = parsePrompt(name);

  const missing: string[] = [];
  for (const key of frontmatter.requires) {
    const value = vars[key];
    if (value === undefined || value === null) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new PromptError(
      `Prompt "${name}" (${path}) requires variables that are missing: ${missing.join(', ')}.\n` +
        `Provided: ${Object.keys(vars).join(', ') || '(none)'}`
    );
  }

  const allowed = new Set([...frontmatter.requires, ...frontmatter.optional]);
  const unknown: string[] = [];
  for (const key of Object.keys(vars)) {
    if (!allowed.has(key)) {
      unknown.push(key);
    }
  }
  if (unknown.length > 0) {
    throw new PromptError(
      `Prompt "${name}" (${path}) was passed unknown variables: ${unknown.join(', ')}.\n` +
        `Declare them in the template's "requires" or "optional" frontmatter, or remove them from the call site.`
    );
  }

  return Mustache.render(body, vars);
}

export function loadPromptFrontmatter(name: string): PromptFrontmatter {
  return parsePrompt(name).frontmatter;
}
