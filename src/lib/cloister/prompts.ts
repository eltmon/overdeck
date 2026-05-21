import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Mustache from 'mustache';
import yaml from 'js-yaml';
import { Data, Effect } from 'effect';

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

export class PromptError extends Data.TaggedError('PromptError')<{
  readonly message: string;
}> {}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function parsePrompt(name: string): Effect.Effect<ParsedPrompt, PromptError> {
  return Effect.gen(function* () {
    const path = join(resolvePromptsDir(), `${name}.md`);

    const raw = yield* Effect.try({
      try: () => readFileSync(path, 'utf-8'),
      catch: (e) =>
        new PromptError({
          message: `Failed to load prompt template "${name}" from ${path}: ${(e as Error).message}`,
        }),
    });

    const match = FRONTMATTER_RE.exec(raw);
    if (!match) {
      return yield* Effect.fail(
        new PromptError({
          message:
            `Prompt template "${name}" at ${path} is missing YAML frontmatter ` +
            `(expected "---\\n<yaml>\\n---\\n<body>" header).`,
        })
      );
    }

    const parsed = yield* Effect.try({
      try: () => yaml.load(match[1]),
      catch: (e) =>
        new PromptError({
          message: `Prompt template "${name}" has invalid YAML frontmatter: ${(e as Error).message}`,
        }),
    });

    if (!parsed || typeof parsed !== 'object') {
      return yield* Effect.fail(
        new PromptError({ message: `Prompt template "${name}" frontmatter must be a YAML mapping.` })
      );
    }
    const fm = parsed as Record<string, unknown>;

    if (typeof fm.name !== 'string' || !fm.name) {
      return yield* Effect.fail(
        new PromptError({
          message: `Prompt template "${name}" frontmatter is missing required field "name".`,
        })
      );
    }
    if (typeof fm.description !== 'string' || !fm.description) {
      return yield* Effect.fail(
        new PromptError({
          message: `Prompt template "${name}" frontmatter is missing required field "description".`,
        })
      );
    }
    if (fm.requires !== undefined && !isStringArray(fm.requires)) {
      return yield* Effect.fail(
        new PromptError({
          message: `Prompt template "${name}" frontmatter "requires" must be a list of strings.`,
        })
      );
    }
    if (fm.optional !== undefined && !isStringArray(fm.optional)) {
      return yield* Effect.fail(
        new PromptError({
          message: `Prompt template "${name}" frontmatter "optional" must be a list of strings.`,
        })
      );
    }

    const frontmatter: PromptFrontmatter = {
      name: fm.name,
      description: fm.description,
      requires: (fm.requires as string[] | undefined) ?? [],
      optional: (fm.optional as string[] | undefined) ?? [],
    };

    return { frontmatter, body: match[2], path };
  });
}

export interface RenderPromptOptions {
  name: string;
  vars: Record<string, unknown>;
}

export function renderPrompt({ name, vars }: RenderPromptOptions): Effect.Effect<string, PromptError> {
  return Effect.gen(function* () {
    const { frontmatter, body, path } = yield* parsePrompt(name);

    const missing: string[] = [];
    for (const key of frontmatter.requires) {
      const value = vars[key];
      if (value === undefined || value === null) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      return yield* Effect.fail(
        new PromptError({
          message:
            `Prompt "${name}" (${path}) requires variables that are missing: ${missing.join(', ')}.\n` +
            `Provided: ${Object.keys(vars).join(', ') || '(none)'}`,
        })
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
      return yield* Effect.fail(
        new PromptError({
          message:
            `Prompt "${name}" (${path}) was passed unknown variables: ${unknown.join(', ')}.\n` +
            `Declare them in the template's "requires" or "optional" frontmatter, or remove them from the call site.`,
        })
      );
    }

    return Mustache.render(body, vars);
  });
}

export function loadPromptFrontmatter(name: string): Effect.Effect<PromptFrontmatter, PromptError> {
  return parsePrompt(name).pipe(Effect.map(({ frontmatter }) => frontmatter));
}
