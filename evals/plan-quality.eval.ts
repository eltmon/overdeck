// E3 plan quality: does a planner write a schema-valid, lint-clean xBRIEF close to the real one?
// Cases: evals/fixtures/plan-quality/*.json (closed issues with a committed spec and PRD).
// Gates: moving the plan role off Opus 5.5.
import { Effect } from 'effect';
import { createScorer, evalite } from 'evalite';
import { renderPrompt } from '../src/lib/cloister/prompts.js';
import { parseXBriefDocument } from '../src/lib/xbrief/io.js';
import { appendEvalRecord, recordFromRun } from './lib/eval-results.js';
import { loadFixtureDir, readRepoText } from './lib/fixtures.js';
import { parsePlanQualityCase, scorePlanQuality, type PlanQualityCase, type PlanQualityScores } from './lib/plan-quality-scorer.js';
import { loadPromptFile, runPromptScenario, type PromptScenarioRun } from './lib/prompt-harness.js';

const cases = loadFixtureDir('evals/fixtures/plan-quality').map((f) => parsePlanQualityCase(f.data));

async function buildPlanQualityUserPrompt(c: PlanQualityCase, prdText: string): Promise<string> {
  const template = await Effect.runPromise(
    renderPrompt({
      name: 'planning',
      vars: {
        ISSUE_ID: c.issueId,
        ISSUE_ID_LOWER: c.issueId.toLowerCase(),
        ISSUE_TITLE: c.title,
        ISSUE_URL: c.url,
        ISSUE_DESCRIPTION: c.body,
        VERSION: 'eval',
        MODEL_AUTHOR: `agent:${process.env['OVERDECK_EVAL_MODEL'] ?? ''}`,
        PRD_DRAFT_LINE: `- **PRD draft:** ${c.prdPath}\n`,
      },
    }),
  );
  return `${template}

The PRD draft at ${c.prdPath} contains:

${prdText}

Eval mode: you have no tools, cannot write files, and cannot run \`pan plan finalize\`. Respond with only the complete xBRIEF JSON document you would write to .overdeck/spec.vbrief.json.`;
}

type PlanQualityOutput = PlanQualityScores & { run: PromptScenarioRun };

evalite<PlanQualityCase, PlanQualityOutput>('plan quality (E3)', {
  data: cases.map((c) => ({ input: c })),
  task: async (c) => {
    const prdText = readRepoText(c.prdPath);
    const reference = parseXBriefDocument(readRepoText(c.referenceSpecPath), c.referenceSpecPath);
    const { text, run } = await runPromptScenario({
      system: loadPromptFile('roles/plan.md'),
      user: await buildPlanQualityUserPrompt(c, prdText),
      maxTokens: 48_000,
    });
    const scores = scorePlanQuality(text, reference, prdText);
    appendEvalRecord(
      recordFromRun('plan-quality', c.id, run, scores.score, {
        schemaPass: scores.schemaPass,
        lintErrors: scores.lintErrors,
        lintPass: scores.lintPass,
        difficultyAgreement: scores.difficultyAgreement,
        fileScopeOverlap: scores.fileScopeOverlap,
        itemCountAgreement: scores.itemCountAgreement,
      }),
    );
    return { ...scores, run };
  },
  scorers: [
    createScorer<PlanQualityCase, PlanQualityOutput>({
      name: 'schema valid',
      description: 'The response contains an xBRIEF document parseXBriefDocument accepts, with at least one item.',
      scorer: ({ output }) => output.schemaPass,
    }),
    createScorer<PlanQualityCase, PlanQualityOutput>({
      name: 'lint clean',
      description: 'lintPlanQuality reports no error-severity issues.',
      scorer: ({ output }) => output.lintPass,
    }),
    createScorer<PlanQualityCase, PlanQualityOutput>({
      name: 'reference agreement',
      description: 'Weighted score: 0.4 lint pass + 0.2 each of difficulty, files_scope and item-count agreement.',
      scorer: ({ output }) => output.score,
    }),
  ],
});
