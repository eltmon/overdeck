import { createScorer, evalite } from 'evalite';
import { loadPromptFile, runPromptScenario } from './lib/prompt-harness.js';

const reviewRole = loadPromptFile('roles/review.md');

interface SynthesisCase {
  name: string;
  userPrompt: string;
  expectedBlocker: string;
}

const correctnessReport = `
# Correctness Review - 2026-07-13

## Summary
One blocking correctness finding.

## Findings

### ! Race condition in status update — \`src/lib/status.ts:42\`
**Evidence tier:** Tier 2
**Changed code:** \`await db.update(...)\` without transaction
**Problem:** Concurrent updates can overwrite each other.
**Runtime impact:** Lost status updates under load.
**Fix:** Wrap the update in a transaction.

## Non-blocking Notes
None

## Clean Areas Checked
src/lib/status.ts
`.trim();

const securityReport = `
# Security Review - 2026-07-13

## Summary
No security blockers.

## Findings
None

## Non-blocking Notes
None

## Clean Areas Checked
src/lib/status.ts
`.trim();

const userPrompt = `
You are the review synthesis agent for PAN-9999. All four convoy reviewers have signaled REVIEWER_READY. Produce the complete synthesis report in the exact format specified in your instructions.

Context:
- Issue ID: PAN-9999
- Branch: feature/pan-9999
- Workspace: workspaces/feature-pan-9999
- HEAD reviewed: abc123def
- Cycle number: 1
- Prior cycle SHA: none

Reviewer reports:

## correctness — .overdeck/review/agent-pan-9999-review-1/correctness.md

${correctnessReport}

## security — .overdeck/review/agent-pan-9999-review-1/security.md

${securityReport}

Emit the complete synthesis markdown report now.
`.trim();

const cases: SynthesisCase[] = [
  {
    name: 'canonical blocker format from reviewer reports',
    userPrompt,
    expectedBlocker: '### [correctness] Race condition in status update — `src/lib/status.ts:42`',
  },
];

evalite<SynthesisCase, { report: string }, SynthesisCase>('review synthesis canonical blocker format', {
  data: cases.map((c) => ({ input: c, expected: c })),
  task: async (input) => {
    const report = await runPromptScenario({ system: reviewRole, user: input.userPrompt });
    return { report };
  },
  scorers: [
    createScorer({
      name: 'verdict is changes requested',
      description: 'When a blocking finding remains, the synthesis verdict must request changes.',
      scorer: ({ output }) => (/verdict:\s*changes requested|verdict:\s*blocked|status blocked/i.test(output.report) ? 1 : 0),
    }),
    createScorer({
      name: 'canonical blocker line preserved',
      description: 'The synthesis must contain the canonical blocker line with sub-role attribution and file:line.',
      scorer: ({ output, expected }) => {
        if (!expected) return 0;
        return output.report.includes(expected.expectedBlocker) ? 1 : 0;
      },
    }),
    createScorer({
      name: 'contains convoy status table',
      description: 'The synthesis report should include a convoy status table.',
      scorer: ({ output }) => (/\|\s*Sub-role\s*\|/.test(output.report) ? 1 : 0),
    }),
    createScorer({
      name: 'contains blocking findings section',
      description: 'The report must have a blocking findings section.',
      scorer: ({ output }) => (/##\s+Blocking Findings/i.test(output.report) ? 1 : 0),
    }),
  ],
});
