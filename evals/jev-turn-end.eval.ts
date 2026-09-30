import { readFileSync } from 'node:fs';
import { createScorer, evalite } from 'evalite';
import { afterAll } from 'vitest';

import { loadConfigSync } from '../src/lib/config-yaml.js';
import { createJevClient } from '../src/lib/jev/client.js';
import { resolveJevConfig } from '../src/lib/jev/config.js';
import { TURN_END_MIN_CONFIDENCE, TURN_END_QUESTIONS, type TurnEndKind } from '../src/lib/jev/questions.js';
import { buildTurnEndState } from '../src/lib/jev/turn-end.js';
import { perClassMetrics } from './lib/jev-turn-end-metrics.js';

/**
 * Jev turn-end eval (PAN-4371): does Jev's turn_end_kind Choice agree with the labeled fixture set?
 *
 * The model and key come from the same resolveJevConfig() as production (jev.model in
 * config.yaml, never a literal). The eval runs deliberately, so it bypasses the background-AI
 * toggle and cost recording, and is skipped with the reason printed when Jev is not configured.
 */
interface TurnEndFixtureCase {
  name: string;
  role: string;
  text: string;
  label: TurnEndKind;
}

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/jev-turn-end.json', import.meta.url), 'utf8'),
) as TurnEndFixtureCase[];

const resolution = resolveJevConfig(loadConfigSync().config);
if (!resolution.ok) {
  console.warn(`[jev-turn-end] skipped: ${resolution.reason}`);
}

const results: { label: TurnEndKind; predicted: TurnEndKind | null }[] = [];

(resolution.ok ? evalite : evalite.skip)<TurnEndFixtureCase, TurnEndKind | null, TurnEndFixtureCase>(
  'Jev turn-end: classification agreement',
  {
    data: fixtures.map((c) => ({ input: c, expected: c })),
    task: async (input) => {
      if (!resolution.ok) throw new Error(`Jev is not configured: ${resolution.reason}`);
      const result = await createJevClient(resolution.config).systemOne({
        state: buildTurnEndState(input.role, input.text),
        questions: TURN_END_QUESTIONS,
        model: resolution.config.model,
      });
      const predicted = result.answers.turn_end_kind.confidence >= TURN_END_MIN_CONFIDENCE
        ? result.answers.turn_end_kind.choice
        : null;
      results.push({ label: input.label, predicted });
      return predicted;
    },
    scorers: [
      createScorer<TurnEndFixtureCase, TurnEndKind | null, TurnEndFixtureCase>({
        name: 'predicted equals label',
        description: 'The predicted turn_end_kind (or null below TURN_END_MIN_CONFIDENCE) matches the fixture label.',
        scorer: ({ output, expected }) => {
          if (!expected) return 0;
          return output === expected.label ? 1 : 0;
        },
      }),
    ],
  },
);

afterAll(() => {
  if (results.length === 0) return;
  console.table(perClassMetrics(results));
});
