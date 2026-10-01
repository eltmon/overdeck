// E2 review recall: does a review lane find the blocker a real review convoy raised?
// Cases: evals/fixtures/review-recall/*.json (mined from merged PRs; see evals/README.md).
// Gates: Sonnet 5.5 on the correctness/performance/requirements lanes and a cross-family lane.
import { createScorer, evalite } from 'evalite';
import { appendEvalRecord, recordFromRun } from './lib/eval-results.js';
import { loadFixtureDir } from './lib/fixtures.js';
import { loadPromptFile, runPromptScenario, type PromptScenarioRun } from './lib/prompt-harness.js';
import {
  parseReviewRecallCase,
  scoreReviewRecall,
  type ReviewRecallCase,
  type ReviewRecallScores,
} from './lib/review-recall-scorer.js';

const cases = loadFixtureDir('evals/fixtures/review-recall').map((f) => parseReviewRecallCase(f.data));

function buildReviewRecallUserPrompt(c: ReviewRecallCase): string {
  const acs =
    c.issue.acceptanceCriteria.length > 0
      ? `Acceptance criteria:\n${c.issue.acceptanceCriteria.map((ac) => `- ${ac}`).join('\n')}\n\n`
      : '';
  return `You are the ${c.lane} reviewer for ${c.issue.id}: ${c.issue.title}.
${acs}Eval mode: you have no tools and no output file. The diff below is an excerpt of the pull request, limited to a few of its changed files. Review what it shows, and do not report a requirement as missing only because its implementation is outside the excerpt. Write your final report, in the exact output format from your instructions, as your response text.

\`\`\`diff
${c.diff}
\`\`\``;
}

type ReviewRecallOutput = Omit<ReviewRecallScores, 'score'> & {
  report: string;
  run: PromptScenarioRun;
};

evalite<ReviewRecallCase, ReviewRecallOutput>('review recall (E2)', {
  data: cases.map((c) => ({ input: c })),
  task: async (c) => {
    const { text: report, run } = await runPromptScenario({
      system: loadPromptFile(`roles/review-${c.lane}.md`),
      user: buildReviewRecallUserPrompt(c),
      maxTokens: 32_000,
    });
    const { score, ...metrics } = scoreReviewRecall(report, c);
    appendEvalRecord(recordFromRun('review-recall', c.id, run, score, { ...metrics }));
    return { ...metrics, report, run };
  },
  scorers: [
    createScorer<ReviewRecallCase, ReviewRecallOutput>({
      name: 'recall',
      description: 'Any finding, at any severity, cites the known blocker file near its line or with two blocker keywords.',
      scorer: ({ output }) => output.recall,
    }),
    createScorer<ReviewRecallCase, ReviewRecallOutput>({
      name: 'blocking recall',
      description: 'A blocking (! or ⊗) heading finding matches the known blocker — what production review gating counts.',
      scorer: ({ output }) => output.blockingRecall,
    }),
    createScorer<ReviewRecallCase, ReviewRecallOutput>({
      name: 'precision',
      description: 'Share of findings, at any severity, that match the known blocker (0 when the report has no findings).',
      scorer: ({ output }) => output.precision ?? 0,
    }),
  ],
});
