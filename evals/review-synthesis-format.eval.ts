import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createScorer, evalite } from 'evalite';

import { loadPromptFile, runPromptScenario } from './lib/prompt-harness.js';

const REVIEW_SYSTEM = loadPromptFile('roles/review.md');

interface ReviewEvalInput {
  name: string;
  prDiffFiles: string[];
  reviewerReports: Record<'security' | 'correctness' | 'performance' | 'requirements', string>;
}

interface ReviewEvalOutput {
  synthesis: string;
}

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'review');

function fixtureInput(name: string): ReviewEvalInput {
  const prDiff = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'pr-diff-files.json'), 'utf8')) as {
    cycle: number;
    headSha: string;
    files: string[];
  };
  return {
    name,
    prDiffFiles: prDiff.files,
    reviewerReports: {
      security: readFileSync(resolve(FIXTURE_DIR, 'security.md'), 'utf8'),
      correctness: readFileSync(resolve(FIXTURE_DIR, 'correctness.md'), 'utf8'),
      performance: readFileSync(resolve(FIXTURE_DIR, 'performance.md'), 'utf8'),
      requirements: readFileSync(resolve(FIXTURE_DIR, 'requirements.md'), 'utf8'),
    },
  };
}

function userPrompt(input: ReviewEvalInput): string {
  const diffBlock = input.prDiffFiles.map((f) => `  - ${f}`).join('\n');
  const reportsBlock = Object.entries(input.reviewerReports)
    .map(([subRole, body]) => `### ${subRole}\n\n${body.trim()}`)
    .join('\n\n---\n\n');
  return [
    'Cycle 1 review synthesis for the PR described below.',
    '',
    'You may not run tools this turn. Write ONLY the markdown body of the synthesis report',
    'that would land at `.overdeck/review/<runId>/synthesis.md`. Do NOT include the CLI signal',
    'command, do NOT include the Pi sentinel line, do NOT include any code fences wrapping',
    'the whole synthesis — the synthesis.md content only.',
    '',
    '## PR diff files (cycle 1)',
    diffBlock,
    '',
    '## Reviewer convoy output',
    reportsBlock,
  ].join('\n');
}

const cases: Array<{ input: ReviewEvalInput }> = [
  { input: fixtureInput('canonical review synthesis for a one-blocker PR') },
];

evalite<ReviewEvalInput, ReviewEvalOutput, undefined>('review synthesis canonical blocker format', {
  data: cases,
  task: async (input) => {
    const synthesis = await runPromptScenario({
      system: REVIEW_SYSTEM,
      user: userPrompt(input),
      maxTokens: 4096,
    });
    return { synthesis };
  },
  scorers: [
    createScorer({
      name: 'canonical-verdict-header',
      description:
        'Output contains a verdict header matching the roles/review.md template, with CHANGES REQUESTED when in-diff blockers exist.',
      scorer: ({ output }) => {
        const match = output.synthesis.match(/^## Verdict:\s+(APPROVED|CHANGES REQUESTED)(\s+—\s+.+)?$/m);
        if (!match) return 0;
        // The fixture carries in-diff blockers (security + requirements:in_pr_scope),
        // so the verdict must be CHANGES REQUESTED, not APPROVED.
        return match[1] === 'CHANGES REQUESTED' ? 1 : 0;
      },
    }),
    createScorer({
      name: 'demotes-out-of-diff',
      description:
        'The correctness ! finding (file outside PR diff) is NOT listed as a blocker; it is demoted or moved to the advisory section.',
      scorer: ({ output }) => {
        const text = output.synthesis;
        // Find the Blocking Findings section; everything between its header and the next ## heading
        // is the canonical "blocker" surface.
        const blockerMatch = text.match(/##\s+Blocking Findings\s*\n([\s\S]*?)(?=\n##\s+|\s*$)/i);
        const blockerBlock = blockerMatch ? blockerMatch[1] : '';
        const outOfDiffFile = 'src/legacy/rollup/buggy-counter.ts';
        if (blockerBlock.includes(outOfDiffFile)) return 0;
        // The demoted finding may appear in Non-blocking Findings, Scope Note, or be referenced
        // as "pre-existing, out of PR scope". At minimum the synthesis must acknowledge the demotion.
        const demoted =
          /demoted|out of PR scope|pre-existing/i.test(text) && text.includes(outOfDiffFile);
        return demoted ? 1 : 0;
      },
    }),
    createScorer({
      name: 'single-cycle-consolidation',
      description:
        'Every in-diff blocker (security + requirements:in_pr_scope) appears in the synthesis blocker section.',
      scorer: ({ output }) => {
        const text = output.synthesis;
        const blockerMatch = text.match(/##\s+Blocking Findings\s*\n([\s\S]*?)(?=\n##\s+|\s*$)/i);
        const blockerBlock = blockerMatch ? blockerMatch[1] : '';
        // The two in-diff blockers in the fixture are tagged "Auth bypass on the prompt surface"
        // (security, src/lib/cloister/prompts/work.md:42) and "Prompt-Change trailer contract"
        // (requirements, in_pr_scope, roles/work.md).
        const hasSecurityBlocker = /Auth bypass on the prompt surface/i.test(blockerBlock);
        const hasRequirementsBlocker = /Prompt-Change trailer contract/i.test(blockerBlock);
        return hasSecurityBlocker && hasRequirementsBlocker ? 1 : 0;
      },
    }),
    createScorer({
      name: 'respects-requirements-scope',
      description:
        'The whole_feature_scope requirements finding is NOT promoted to a blocker; it lives in Non-blocking Findings or Scope Note.',
      scorer: ({ output }) => {
        const text = output.synthesis;
        const blockerMatch = text.match(/##\s+Blocking Findings\s*\n([\s\S]*?)(?=\n##\s+|\s*$)/i);
        const blockerBlock = blockerMatch ? blockerMatch[1] : '';
        const wholeFeatureFinding = 'Whole-feature brief author-gate audit trail';
        if (blockerBlock.includes(wholeFeatureFinding)) return 0;
        // Either absent, demoted, or surfaced in ## Scope Note. The role template says to
        // surface whole_feature_scope in ## Scope Note, but at minimum it must not be a blocker.
        const surfacedAsScope =
          /##\s+Scope Note/i.test(text) && text.includes(wholeFeatureFinding);
        const demoted = /demoted|whole[- ]feature scope/i.test(text) && text.includes(wholeFeatureFinding);
        return surfacedAsScope || demoted ? 1 : 0;
      },
    }),
  ],
  columns: ({ input }) => [
    { label: 'Case', value: input.name },
    { label: 'PR files', value: String(input.prDiffFiles.length) },
  ],
});