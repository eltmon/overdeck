import { describe, it, expect, beforeEach, afterEach } from '@effect/vitest';
import { Effect } from 'effect';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { renderPrompt, loadPromptFrontmatter, PromptError } from '../prompts.js';

const __filename = fileURLToPath(import.meta.url);
const PROMPTS_DIR = join(dirname(__filename), '..', 'prompts');

const SCRATCH = '__test-scratch__';
const SCRATCH_PATH = join(PROMPTS_DIR, `${SCRATCH}.md`);

function writeScratch(body: string): void {
  mkdirSync(PROMPTS_DIR, { recursive: true });
  writeFileSync(SCRATCH_PATH, body, 'utf-8');
}

afterEach(() => {
  try {
    rmSync(SCRATCH_PATH, { force: true });
  } catch {
    // ignore
  }
});

describe('prompts loader', () => {
  describe('frontmatter parsing', () => {
    it.effect('parses valid frontmatter', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
description: A scratch template for tests
requires:
  - ISSUE_ID
optional:
  - LOCAL
  - REMOTE
---
Issue: {{ISSUE_ID}}`
        );
        const fm = yield* loadPromptFrontmatter(SCRATCH);
        expect(fm.name).toBe('scratch');
        expect(fm.description).toBe('A scratch template for tests');
        expect(fm.requires).toEqual(['ISSUE_ID']);
        expect(fm.optional).toEqual(['LOCAL', 'REMOTE']);
      })
    );

    it.effect('defaults requires/optional to empty arrays when omitted', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
description: minimal
---
hello`
        );
        const fm = yield* loadPromptFrontmatter(SCRATCH);
        expect(fm.requires).toEqual([]);
        expect(fm.optional).toEqual([]);
      })
    );

    it.effect('fails when frontmatter is missing entirely', () =>
      Effect.gen(function* () {
        writeScratch('hello world');
        const err = yield* Effect.flip(loadPromptFrontmatter(SCRATCH));
        expect(err).toBeInstanceOf(PromptError);
        expect(err.message).toMatch(/missing YAML frontmatter/);
      })
    );

    it.effect('fails when name field is missing', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
description: no name
---
body`
        );
        const err = yield* Effect.flip(loadPromptFrontmatter(SCRATCH));
        expect(err.message).toMatch(/missing required field "name"/);
      })
    );

    it.effect('fails when description field is missing', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
---
body`
        );
        const err = yield* Effect.flip(loadPromptFrontmatter(SCRATCH));
        expect(err.message).toMatch(/missing required field "description"/);
      })
    );

    it.effect('fails when requires is not a string array', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
description: bad requires
requires:
  foo: bar
---
body`
        );
        const err = yield* Effect.flip(loadPromptFrontmatter(SCRATCH));
        expect(err.message).toMatch(/"requires" must be a list of strings/);
      })
    );

    it.effect('fails when YAML is malformed', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
description: bad
optional: [unclosed
---
body`
        );
        const err = yield* Effect.flip(loadPromptFrontmatter(SCRATCH));
        expect(err.message).toMatch(/invalid YAML frontmatter/);
      })
    );

    it.effect('fails when template file is missing', () =>
      Effect.gen(function* () {
        const err = yield* Effect.flip(loadPromptFrontmatter('definitely-not-a-real-template'));
        expect(err.message).toMatch(/Failed to load prompt template/);
      })
    );
  });

  describe('rendering', () => {
    it.effect('substitutes a required variable', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
description: simple
requires:
  - ISSUE_ID
---
Issue {{ISSUE_ID}} is in progress.`
        );
        const out = yield* renderPrompt({ name: SCRATCH, vars: { ISSUE_ID: 'PAN-123' } });
        expect(out).toBe('Issue PAN-123 is in progress.');
      })
    );

    it.effect('does NOT HTML-escape values (markdown output, not HTML)', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
description: escape check
requires:
  - DIFF
---
{{DIFF}}`
        );
        const out = yield* renderPrompt({
          name: SCRATCH,
          vars: { DIFF: '<script>alert("xss")</script> & "quoted"' },
        });
        expect(out).toBe('<script>alert("xss")</script> & "quoted"');
      })
    );

    it.effect('renders a section when the variable is a non-empty string and resolves the variable inside', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
description: section context
optional:
  - BEADS
---
{{#BEADS}}Beads:
{{BEADS}}{{/BEADS}}`
        );
        const out = yield* renderPrompt({ name: SCRATCH, vars: { BEADS: '- bead-1\n- bead-2' } });
        expect(out).toContain('Beads:');
        expect(out).toContain('- bead-1');
        expect(out).toContain('- bead-2');
      })
    );

    it.effect('hides a section when the variable is an empty string', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
description: empty section
optional:
  - BEADS
---
before
{{#BEADS}}should not appear{{/BEADS}}
after`
        );
        const out = yield* renderPrompt({ name: SCRATCH, vars: { BEADS: '' } });
        expect(out).not.toContain('should not appear');
        expect(out).toContain('before');
        expect(out).toContain('after');
      })
    );

    it.effect('hides a section when the variable is undefined and the field is optional', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
description: undefined section
optional:
  - BEADS
---
{{#BEADS}}hidden{{/BEADS}}done`
        );
        const out = yield* renderPrompt({ name: SCRATCH, vars: {} });
        expect(out).toBe('done');
      })
    );

    it.effect('switches between LOCAL and REMOTE blocks via boolean flags', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
description: env switching
optional:
  - LOCAL
  - REMOTE
---
{{#LOCAL}}local-only{{/LOCAL}}{{#REMOTE}}remote-only{{/REMOTE}}`
        );
        const local = yield* renderPrompt({ name: SCRATCH, vars: { LOCAL: true, REMOTE: false } });
        const remote = yield* renderPrompt({ name: SCRATCH, vars: { LOCAL: false, REMOTE: true } });
        expect(local).toBe('local-only');
        expect(remote).toBe('remote-only');
      })
    );

    it.effect('renders Playwright isolation guidance in the uat-agent prompt', () =>
      Effect.gen(function* () {
        const out = yield* renderPrompt({
          name: 'uat-agent',
          vars: {
            ISSUE_ID: 'PAN-611',
            WORKSPACE: '/workspace',
            FRONTEND_URL: 'https://pan.localhost',
            API_URL: 'https://pan.localhost/api',
            TEST_TOKEN_API: 'test-key',
          },
        });

        expect(out).toContain('## Playwright Isolation');
        expect(out).toContain('isolated Playwright browser instance/profile');
        expect(out).toContain("Never rely on another agent's browser session");
      })
    );

    it.effect('renders MEMORY_CONTEXT in role prompt templates and hides it when empty', () =>
      Effect.gen(function* () {
        const memoryContext = '<panopticon-memory-context>durable context</panopticon-memory-context>';
        const planning = yield* renderPrompt({
          name: 'planning',
          vars: {
            ISSUE_ID: 'PAN-611',
            ISSUE_ID_LOWER: 'pan-611',
            ISSUE_TITLE: 'Memory context',
            ISSUE_URL: 'https://example.test/PAN-611',
            ISSUE_DESCRIPTION: 'Need memory context',
            VERSION: '0.0.0',
            MODEL_AUTHOR: 'agent:test',
            MEMORY_CONTEXT: memoryContext,
          },
        });
        const work = yield* renderPrompt({
          name: 'work',
          vars: {
            ISSUE_ID: 'PAN-611',
            ISSUE_ID_LOWER: 'pan-611',
            WORKSPACE_PATH: '/workspace',
            LOCAL: true,
            REMOTE: false,
            MEMORY_CONTEXT: memoryContext,
          },
        });
        const review = yield* renderPrompt({
          name: 'review',
          vars: {
            ISSUE_ID: 'PAN-611',
            BRANCH: 'feature/pan-611',
            WORKSPACE: '/workspace',
            DIFF_BASE: 'main',
            IS_POLYREPO: false,
            GIT_DIFF_COMMANDS: 'git diff --name-only main...HEAD',
            GIT_DIFF_FILE_CMD: 'git diff main...HEAD -- <file>',
            API_URL: 'http://localhost:3011',
            MEMORY_CONTEXT: memoryContext,
          },
        });
        const test = yield* renderPrompt({
          name: 'test',
          vars: {
            ISSUE_ID: 'PAN-611',
            BRANCH: 'feature/pan-611',
            WORKSPACE: '/workspace',
            IS_POLYREPO: false,
            TEST_COMMANDS: 'npm test',
            BASELINE_COMMANDS: 'git checkout main && npm test',
            TEST_CONFIG_SUMMARY: 'default test suite',
            TIMEOUT_MS: 600000,
            API_URL: 'http://localhost:3011',
            FEATURE_NAME: 'pan-611',
            DOCKER_PS_FORMAT: '{{.Names}}',
            MEMORY_CONTEXT: memoryContext,
          },
        });
        const merge = yield* renderPrompt({
          name: 'merge',
          vars: {
            ISSUE_ID: 'PAN-611',
            SOURCE_BRANCH: 'feature/pan-611',
            TARGET_BRANCH: 'main',
            PROJECT_PATH: '/workspace',
            DO_PUSH: false,
            DO_BUILD: false,
            API_URL: 'http://localhost:3011',
            MEMORY_CONTEXT: memoryContext,
          },
        });
        const emptyWork = yield* renderPrompt({
          name: 'work',
          vars: {
            ISSUE_ID: 'PAN-611',
            ISSUE_ID_LOWER: 'pan-611',
            WORKSPACE_PATH: '/workspace',
            LOCAL: true,
            REMOTE: false,
            MEMORY_CONTEXT: '',
          },
        });

        for (const out of [planning, work, review, test, merge]) {
          expect(out).toContain('## Memory Context');
          expect(out).toContain(memoryContext);
        }
        expect(emptyWork).not.toContain('## Memory Context');
        expect(emptyWork).not.toContain('no context found');
      })
    );

    it.effect('renders planning TLDR guidance only when TLDR_AVAILABLE is true', () =>
      Effect.gen(function* () {
        const baseVars = {
          ISSUE_ID: 'PAN-611',
          ISSUE_ID_LOWER: 'pan-611',
          ISSUE_TITLE: 'TLDR planning',
          ISSUE_URL: 'https://example.test/PAN-611',
          ISSUE_DESCRIPTION: 'Need TLDR planning context',
          VERSION: '0.0.0',
          MODEL_AUTHOR: 'agent:test',
        };
        const enabled = yield* renderPrompt({
          name: 'planning',
          vars: { ...baseVars, TLDR_AVAILABLE: true },
        });
        const disabled = yield* renderPrompt({
          name: 'planning',
          vars: { ...baseVars, TLDR_AVAILABLE: false },
        });
        const absent = yield* renderPrompt({ name: 'planning', vars: baseVars });

        expect(enabled).toContain('### TLDR: Token-Efficient Code Discovery');
        expect(enabled).toContain('tldr_context');
        expect(enabled).toContain('tldr_structure');
        expect(enabled).toContain('tldr_semantic');
        expect(enabled).toContain('tldr_calls');
        expect(enabled).toContain('tldr_impact');
        expect(enabled).toContain('Prefer these summaries during exploration');
        expect(disabled).not.toContain('### TLDR: Token-Efficient Code Discovery');
        expect(absent).not.toContain('### TLDR: Token-Efficient Code Discovery');
      })
    );

    it.effect('renders resume-work TLDR guidance only when TLDR_AVAILABLE is true', () =>
      Effect.gen(function* () {
        const baseVars = {
          ISSUE_ID: 'PAN-611',
          INSTRUCTIONS_BLOCK: 'Continue the bead.',
        };
        const enabled = yield* renderPrompt({
          name: 'resume-work',
          vars: { ...baseVars, TLDR_AVAILABLE: true },
        });
        const disabled = yield* renderPrompt({
          name: 'resume-work',
          vars: { ...baseVars, TLDR_AVAILABLE: false },
        });
        const absent = yield* renderPrompt({ name: 'resume-work', vars: baseVars });

        expect(enabled).toContain('## TLDR: Fast Re-Orientation');
        expect(enabled).toContain('tldr_context');
        expect(enabled).toContain('tldr_structure');
        expect(enabled).toContain('tldr_semantic');
        expect(enabled).toContain('tldr_calls');
        expect(enabled).toContain('tldr_impact');
        expect(disabled).not.toContain('## TLDR: Fast Re-Orientation');
        expect(absent).not.toContain('## TLDR: Fast Re-Orientation');
      })
    );

    it.effect('renders review TLDR guidance only when TLDR_AVAILABLE is true', () =>
      Effect.gen(function* () {
        const baseVars = {
          ISSUE_ID: 'PAN-611',
          BRANCH: 'feature/pan-611',
          WORKSPACE: '/workspace',
          DIFF_BASE: 'main',
          IS_POLYREPO: false,
          GIT_DIFF_COMMANDS: 'git diff --name-only main...HEAD',
          GIT_DIFF_FILE_CMD: 'git diff main...HEAD -- <file>',
          API_URL: 'http://localhost:3011',
        };
        const enabled = yield* renderPrompt({
          name: 'review',
          vars: { ...baseVars, TLDR_AVAILABLE: true },
        });
        const disabled = yield* renderPrompt({
          name: 'review',
          vars: { ...baseVars, TLDR_AVAILABLE: false },
        });
        const absent = yield* renderPrompt({ name: 'review', vars: baseVars });

        expect(enabled).toContain('## TLDR: Efficient Review Context');
        expect(enabled).toContain('tldr_context');
        expect(enabled).toContain('tldr_structure');
        expect(enabled).toContain('tldr_semantic');
        expect(enabled).toContain('tldr_calls');
        expect(enabled).toContain('tldr_impact');
        expect(disabled).not.toContain('## TLDR: Efficient Review Context');
        expect(absent).not.toContain('## TLDR: Efficient Review Context');
      })
    );

    it.effect('renders Playwright isolation guidance in the work prompt', () =>
      Effect.gen(function* () {
        const out = yield* renderPrompt({
          name: 'work',
          vars: {
            ISSUE_ID: 'PAN-611',
            ISSUE_ID_LOWER: 'pan-611',
            WORKSPACE_PATH: '/workspace',
            LOCAL: true,
            REMOTE: false,
            PROJECT_ROOT: '/project',
            BEADS_TASKS: '',
            STITCH_DESIGNS: '',
            POLYREPO_CONTEXT: '',
            PENDING_FEEDBACK: '',
            NEW_TRACKER_CONTEXT: '',
            TLDR_AVAILABLE: false,
          },
        });

        expect(out).toContain('## Playwright Isolation');
        expect(out).toContain('isolated browser instance/profile');
        expect(out).toContain("Never rely on another agent's browser session");
      })
    );
  });

  describe('fail-loud validation', () => {
    it.effect('fails when a required variable is missing', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
description: requires test
requires:
  - ISSUE_ID
  - WORKSPACE_PATH
---
{{ISSUE_ID}} {{WORKSPACE_PATH}}`
        );
        const err = yield* Effect.flip(
          renderPrompt({ name: SCRATCH, vars: { ISSUE_ID: 'PAN-1' } })
        );
        expect(err.message).toMatch(/requires variables that are missing: WORKSPACE_PATH/);
      })
    );

    it.effect('fails when an unknown variable is passed', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
description: unknown var test
requires:
  - ISSUE_ID
---
{{ISSUE_ID}}`
        );
        const err = yield* Effect.flip(
          renderPrompt({ name: SCRATCH, vars: { ISSUE_ID: 'PAN-1', WROKSPACE: '/tmp' } })
        );
        expect(err.message).toMatch(/unknown variables: WROKSPACE/);
      })
    );

    it.effect('accepts an empty-string value for a required variable (treated as defined)', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
description: empty required
requires:
  - VALUE
---
[{{VALUE}}]`
        );
        const out = yield* renderPrompt({ name: SCRATCH, vars: { VALUE: '' } });
        expect(out).toBe('[]');
      })
    );

    it.effect('accepts a boolean false value for a required variable', () =>
      Effect.gen(function* () {
        writeScratch(
          `---
name: scratch
description: false required
requires:
  - FLAG
---
{{#FLAG}}on{{/FLAG}}{{^FLAG}}off{{/FLAG}}`
        );
        const out = yield* renderPrompt({ name: SCRATCH, vars: { FLAG: false } });
        expect(out).toBe('off');
      })
    );
  });

  describe('live review template', () => {
    const baseReviewVars = {
      ISSUE_ID: 'PAN-999',
      BRANCH: 'feature/pan-999',
      WORKSPACE: '/tmp/repo',
      DIFF_BASE: 'main',
      IS_POLYREPO: false,
      GIT_DIFF_COMMANDS: 'git diff --name-only main...HEAD',
      GIT_DIFF_FILE_CMD: 'git diff main...HEAD -- <file>',
      API_URL: 'http://localhost:3011',
    };

    it.effect('reports stale branches through specialists/done instead of direct review status updates', () =>
      Effect.gen(function* () {
        const out = yield* renderPrompt({
          name: 'review',
          vars: baseReviewVars,
        });
        expect(out).toContain('curl -s -X POST http://localhost:3011/api/specialists/done');
        expect(out).toContain('"specialist":"review","issueId":"PAN-999","status":"passed"');
        expect(out).not.toContain('/api/review/PAN-999/status');
        expect(out).not.toContain('pan tell PAN-999');
      })
    );

    it.effect('reports blocked review results through specialists/done instead of pan tell', () =>
      Effect.gen(function* () {
        const out = yield* renderPrompt({
          name: 'review',
          vars: baseReviewVars,
        });
        expect(out).toContain('"specialist":"review","issueId":"PAN-999","status":"failed"');
        expect(out).toContain('Do NOT message the work agent directly');
        expect(out).not.toContain('pan tell PAN-999');
      })
    );
  });

  describe('live merge template', () => {
    const baseVars = {
      ISSUE_ID: 'PAN-999',
      SOURCE_BRANCH: 'feature/pan-999',
      TARGET_BRANCH: 'main',
      PROJECT_PATH: '/tmp/repo',
      API_URL: 'http://localhost:3011',
    };

    it.effect('renders push+build flow when DO_PUSH and DO_BUILD are true', () =>
      Effect.gen(function* () {
        const out = yield* renderPrompt({
          name: 'merge',
          vars: { ...baseVars, DO_PUSH: true, DO_BUILD: true },
        });
        expect(out).toContain('git push origin main');
        expect(out).toContain('PHASE 4');
        expect(out).toContain('Build the project');
        expect(out).toContain('curl -s -X POST http://localhost:3011/api/specialists/done');
        expect(out).not.toContain('Do NOT push');
      })
    );

    it.effect('renders validation-only flow when DO_PUSH is false', () =>
      Effect.gen(function* () {
        const out = yield* renderPrompt({
          name: 'merge',
          vars: { ...baseVars, DO_PUSH: false, DO_BUILD: false },
        });
        expect(out).toContain('Do NOT push to main');
        expect(out).toContain('NEVER push to `main`');
        expect(out).not.toContain('13. PUSH');
        expect(out).not.toContain('Build the project');
      })
    );

    it.effect('hides done-report when SKIP_DONE_REPORT is true', () =>
      Effect.gen(function* () {
        const out = yield* renderPrompt({
          name: 'merge',
          vars: {
            ...baseVars,
            DO_PUSH: true,
            DO_BUILD: true,
            SKIP_DONE_REPORT: true,
          },
        });
        expect(out).toContain('DO NOT call `/api/specialists/done`');
        expect(out).not.toContain('curl -s -X POST http://localhost:3011/api/specialists/done');
      })
    );

    it.effect('renders polyrepo header when IS_POLYREPO is true', () =>
      Effect.gen(function* () {
        const out = yield* renderPrompt({
          name: 'merge',
          vars: {
            ...baseVars,
            DO_PUSH: false,
            DO_BUILD: false,
            IS_POLYREPO: true,
            POLYREPO_DIRS: 'frontend, backend',
          },
        });
        expect(out).toContain('POLYREPO project');
        expect(out).toContain('frontend, backend');
      })
    );
  });
});
