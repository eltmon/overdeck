import { readFileSync } from 'node:fs';
import { createScorer, evalite } from 'evalite';

import { loadConfigSync } from '../src/lib/config-yaml.js';
import { createJevClient } from '../src/lib/jev/client.js';
import { resolveJevConfig } from '../src/lib/jev/config.js';
import { JEV_SMOKE_NOUL_THRESHOLD, JEV_SMOKE_QUESTIONS } from '../src/lib/jev/questions.js';

/**
 * Jev smoke eval (PAN-4369): does Jev's question-detection Noul agree with a small labeled set?
 *
 * The model and key come from the same resolveJevConfig() as production (jev.model in
 * config.yaml, never a literal). The eval runs deliberately, so it bypasses the background-AI
 * toggle and cost recording, and is skipped with the reason printed when Jev is not configured.
 */
interface JevSmokeCase {
  name: string;
  state: string;
  asksQuestion: boolean;
}

const cases = JSON.parse(
  readFileSync(new URL('./fixtures/jev-smoke.json', import.meta.url), 'utf8'),
) as JevSmokeCase[];

const resolution = resolveJevConfig(loadConfigSync().config);
if (!resolution.ok) {
  console.warn(`[jev-smoke] skipped: ${resolution.reason}`);
}

(resolution.ok ? evalite : evalite.skip)<JevSmokeCase, number, JevSmokeCase>('Jev smoke: question detection', {
  data: cases.map((c) => ({ input: c, expected: c })),
  task: async (input) => {
    if (!resolution.ok) throw new Error(`Jev is not configured: ${resolution.reason}`);
    const result = await createJevClient(resolution.config).systemOne({
      state: input.state,
      questions: JEV_SMOKE_QUESTIONS,
      model: resolution.config.model,
    });
    return result.answers.asks_question.noul;
  },
  scorers: [
    createScorer<JevSmokeCase, number, JevSmokeCase>({
      name: 'agrees with the label',
      description: 'The Noul crosses the threshold exactly when the message asks the reader a question or for a decision.',
      scorer: ({ output, expected }) => {
        if (!expected) return 0;
        return (output >= JEV_SMOKE_NOUL_THRESHOLD) === expected.asksQuestion ? 1 : 0;
      },
    }),
  ],
});
