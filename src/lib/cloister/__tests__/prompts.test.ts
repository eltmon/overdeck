import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    it('parses valid frontmatter', () => {
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
      const fm = loadPromptFrontmatter(SCRATCH);
      expect(fm.name).toBe('scratch');
      expect(fm.description).toBe('A scratch template for tests');
      expect(fm.requires).toEqual(['ISSUE_ID']);
      expect(fm.optional).toEqual(['LOCAL', 'REMOTE']);
    });

    it('defaults requires/optional to empty arrays when omitted', () => {
      writeScratch(
        `---
name: scratch
description: minimal
---
hello`
      );
      const fm = loadPromptFrontmatter(SCRATCH);
      expect(fm.requires).toEqual([]);
      expect(fm.optional).toEqual([]);
    });

    it('throws when frontmatter is missing entirely', () => {
      writeScratch('hello world');
      expect(() => loadPromptFrontmatter(SCRATCH)).toThrow(PromptError);
      expect(() => loadPromptFrontmatter(SCRATCH)).toThrow(/missing YAML frontmatter/);
    });

    it('throws when name field is missing', () => {
      writeScratch(
        `---
description: no name
---
body`
      );
      expect(() => loadPromptFrontmatter(SCRATCH)).toThrow(/missing required field "name"/);
    });

    it('throws when description field is missing', () => {
      writeScratch(
        `---
name: scratch
---
body`
      );
      expect(() => loadPromptFrontmatter(SCRATCH)).toThrow(/missing required field "description"/);
    });

    it('throws when requires is not a string array', () => {
      writeScratch(
        `---
name: scratch
description: bad requires
requires:
  foo: bar
---
body`
      );
      expect(() => loadPromptFrontmatter(SCRATCH)).toThrow(/"requires" must be a list of strings/);
    });

    it('throws when YAML is malformed', () => {
      writeScratch(
        `---
name: scratch
description: bad
optional: [unclosed
---
body`
      );
      expect(() => loadPromptFrontmatter(SCRATCH)).toThrow(/invalid YAML frontmatter/);
    });

    it('throws when template file is missing', () => {
      expect(() => loadPromptFrontmatter('definitely-not-a-real-template')).toThrow(
        /Failed to load prompt template/
      );
    });
  });

  describe('rendering', () => {
    it('substitutes a required variable', () => {
      writeScratch(
        `---
name: scratch
description: simple
requires:
  - ISSUE_ID
---
Issue {{ISSUE_ID}} is in progress.`
      );
      const out = renderPrompt({ name: SCRATCH, vars: { ISSUE_ID: 'PAN-123' } });
      expect(out).toBe('Issue PAN-123 is in progress.');
    });

    it('does NOT HTML-escape values (markdown output, not HTML)', () => {
      writeScratch(
        `---
name: scratch
description: escape check
requires:
  - DIFF
---
{{DIFF}}`
      );
      const out = renderPrompt({
        name: SCRATCH,
        vars: { DIFF: '<script>alert("xss")</script> & "quoted"' },
      });
      expect(out).toBe('<script>alert("xss")</script> & "quoted"');
    });

    it('renders a section when the variable is a non-empty string and resolves the variable inside', () => {
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
      const out = renderPrompt({ name: SCRATCH, vars: { BEADS: '- bead-1\n- bead-2' } });
      expect(out).toContain('Beads:');
      expect(out).toContain('- bead-1');
      expect(out).toContain('- bead-2');
    });

    it('hides a section when the variable is an empty string', () => {
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
      const out = renderPrompt({ name: SCRATCH, vars: { BEADS: '' } });
      expect(out).not.toContain('should not appear');
      expect(out).toContain('before');
      expect(out).toContain('after');
    });

    it('hides a section when the variable is undefined and the field is optional', () => {
      writeScratch(
        `---
name: scratch
description: undefined section
optional:
  - BEADS
---
{{#BEADS}}hidden{{/BEADS}}done`
      );
      const out = renderPrompt({ name: SCRATCH, vars: {} });
      expect(out).toBe('done');
    });

    it('switches between LOCAL and REMOTE blocks via boolean flags', () => {
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
      const local = renderPrompt({ name: SCRATCH, vars: { LOCAL: true, REMOTE: false } });
      const remote = renderPrompt({ name: SCRATCH, vars: { LOCAL: false, REMOTE: true } });
      expect(local).toBe('local-only');
      expect(remote).toBe('remote-only');
    });

    it('renders Playwright isolation guidance in the uat-agent prompt', () => {
      const out = renderPrompt({
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
    });

    it('renders Playwright isolation guidance in the work prompt', () => {
      const out = renderPrompt({
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
    });
  });

  describe('fail-loud validation', () => {
    it('throws when a required variable is missing', () => {
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
      expect(() => renderPrompt({ name: SCRATCH, vars: { ISSUE_ID: 'PAN-1' } })).toThrow(
        /requires variables that are missing: WORKSPACE_PATH/
      );
    });

    it('throws when an unknown variable is passed', () => {
      writeScratch(
        `---
name: scratch
description: unknown var test
requires:
  - ISSUE_ID
---
{{ISSUE_ID}}`
      );
      expect(() =>
        renderPrompt({ name: SCRATCH, vars: { ISSUE_ID: 'PAN-1', WROKSPACE: '/tmp' } })
      ).toThrow(/unknown variables: WROKSPACE/);
    });

    it('accepts an empty-string value for a required variable (treated as defined)', () => {
      writeScratch(
        `---
name: scratch
description: empty required
requires:
  - VALUE
---
[{{VALUE}}]`
      );
      const out = renderPrompt({ name: SCRATCH, vars: { VALUE: '' } });
      expect(out).toBe('[]');
    });

    it('accepts a boolean false value for a required variable', () => {
      writeScratch(
        `---
name: scratch
description: false required
requires:
  - FLAG
---
{{#FLAG}}on{{/FLAG}}{{^FLAG}}off{{/FLAG}}`
      );
      const out = renderPrompt({ name: SCRATCH, vars: { FLAG: false } });
      expect(out).toBe('off');
    });
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

    it('reports stale branches through specialists/done instead of direct review status updates', () => {
      const out = renderPrompt({
        name: 'review',
        vars: baseReviewVars,
      });
      expect(out).toContain('curl -s -X POST http://localhost:3011/api/specialists/done');
      expect(out).toContain('"specialist":"review","issueId":"PAN-999","status":"passed"');
      expect(out).not.toContain('/api/review/PAN-999/status');
      expect(out).not.toContain('pan tell PAN-999');
    });

    it('reports blocked review results through specialists/done instead of pan tell', () => {
      const out = renderPrompt({
        name: 'review',
        vars: baseReviewVars,
      });
      expect(out).toContain('"specialist":"review","issueId":"PAN-999","status":"failed"');
      expect(out).toContain('Do NOT message the work agent directly');
      expect(out).not.toContain('pan tell PAN-999');
    });
  });

  describe('live merge template', () => {
    const baseVars = {
      ISSUE_ID: 'PAN-999',
      SOURCE_BRANCH: 'feature/pan-999',
      TARGET_BRANCH: 'main',
      PROJECT_PATH: '/tmp/repo',
      API_URL: 'http://localhost:3011',
    };

    it('renders push+build flow when DO_PUSH and DO_BUILD are true', () => {
      const out = renderPrompt({
        name: 'merge',
        vars: { ...baseVars, DO_PUSH: true, DO_BUILD: true },
      });
      expect(out).toContain('git push origin main');
      expect(out).toContain('PHASE 4');
      expect(out).toContain('Build the project');
      expect(out).toContain('curl -s -X POST http://localhost:3011/api/specialists/done');
      expect(out).not.toContain('Do NOT push');
    });

    it('renders validation-only flow when DO_PUSH is false', () => {
      const out = renderPrompt({
        name: 'merge',
        vars: { ...baseVars, DO_PUSH: false, DO_BUILD: false },
      });
      expect(out).toContain('Do NOT push to main');
      expect(out).toContain('NEVER push to `main`');
      expect(out).not.toContain('13. PUSH');
      expect(out).not.toContain('Build the project');
    });

    it('hides done-report when SKIP_DONE_REPORT is true', () => {
      const out = renderPrompt({
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
    });

    it('renders polyrepo header when IS_POLYREPO is true', () => {
      const out = renderPrompt({
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
    });
  });
});
