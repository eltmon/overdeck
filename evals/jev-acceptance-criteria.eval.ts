import { readFileSync } from 'node:fs';
import { createScorer, evalite } from 'evalite';

import { loadConfigSync } from '../src/lib/config-yaml.js';
import { createJevClient } from '../src/lib/jev/client.js';
import { resolveJevConfig } from '../src/lib/jev/config.js';
import { JEV_AC_COMPOUND_MAX_NOUL, JEV_AC_OBSERVABLE_MIN_NOUL } from '../src/lib/jev/questions.js';
import { buildAcceptanceCriteriaRequest } from '../src/lib/jev/acceptance-criteria.js';
import type { XBriefDocument } from '../src/lib/xbrief/types.js';

/**
 * Jev acceptance-criteria eval (PAN-4372 FR-10): do the observable/compound Nouls agree with
 * hand labels on 60+ real AC titles pulled verbatim from .pan/specs/*.xbrief.json?
 *
 * The model and key come from the same resolveJevConfig() as production (jev.model in
 * config.yaml, never a literal). The eval runs deliberately, so it bypasses the background-AI
 * toggle and cost recording, and is skipped with the reason printed when Jev is not configured.
 * createJevClient is called directly here only — production code always goes through assess().
 */
interface FixtureEntry {
  specFile: string;
  itemId: string;
  acId: string;
  title: string;
  observable: boolean;
  compound: boolean;
}

interface EvalCase {
  specFile: string;
  entries: FixtureEntry[];
}

interface TaskOutput {
  answers: Record<string, { type: string; noul?: number }>;
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/jev-acceptance-criteria.json', import.meta.url), 'utf8'),
) as FixtureEntry[];

const groups = new Map<string, FixtureEntry[]>();
for (const entry of fixture) {
  groups.set(entry.specFile, [...(groups.get(entry.specFile) ?? []), entry]);
}
const cases: EvalCase[] = [...groups.entries()].map(([specFile, entries]) => ({ specFile, entries }));

/** Builds a minimal xBRIEF doc from one specFile group, grouping ACs back under their itemId. */
function buildDoc(entries: FixtureEntry[]): XBriefDocument {
  const itemIds = [...new Set(entries.map((e) => e.itemId))];
  return {
    xBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'jev-acceptance-criteria-eval',
      title: 'Eval fixture plan',
      status: 'proposed',
      items: itemIds.map((itemId) => ({
        id: itemId,
        title: itemId,
        status: 'pending' as const,
        subItems: entries
          .filter((e) => e.itemId === itemId)
          .map((e) => ({
            id: e.acId,
            title: e.title,
            status: 'pending' as const,
            metadata: { kind: 'acceptance_criterion' },
          })),
      })),
      edges: [],
    },
  };
}

function noulOf(answer: { type: string; noul?: number } | undefined): number | null {
  return answer?.type === 'noul' && typeof answer.noul === 'number' ? answer.noul : null;
}

const resolution = resolveJevConfig(loadConfigSync().config);
if (!resolution.ok) {
  console.warn(`[jev-acceptance-criteria] skipped: ${resolution.reason}`);
}

(resolution.ok ? evalite : evalite.skip)<EvalCase, TaskOutput, FixtureEntry[]>(
  'Jev acceptance-criteria: observable/compound agreement',
  {
    data: cases.map((c) => ({ input: c, expected: c.entries })),
    task: async (input) => {
      if (!resolution.ok) throw new Error(`Jev is not configured: ${resolution.reason}`);
      const request = buildAcceptanceCriteriaRequest(buildDoc(input.entries));
      const result = await createJevClient(resolution.config).systemOne({
        state: request.state,
        questions: request.questions,
        model: resolution.config.model,
      });
      return { answers: result.answers as TaskOutput['answers'] };
    },
    scorers: [
      createScorer<EvalCase, TaskOutput, FixtureEntry[]>({
        name: 'observable agreement',
        description: 'observable_<id> crosses JEV_AC_OBSERVABLE_MIN_NOUL exactly when the label says the AC is observable.',
        scorer: ({ output, expected }) => {
          if (!expected || expected.length === 0) return 0;
          let correct = 0;
          for (const entry of expected) {
            const noul = noulOf(output.answers[`observable_${entry.acId}`]);
            if (noul === null) continue;
            if ((noul >= JEV_AC_OBSERVABLE_MIN_NOUL) === entry.observable) correct++;
          }
          return correct / expected.length;
        },
      }),
      createScorer<EvalCase, TaskOutput, FixtureEntry[]>({
        name: 'compound agreement',
        description: 'compound_<id> crosses JEV_AC_COMPOUND_MAX_NOUL exactly when the label says the AC is compound.',
        scorer: ({ output, expected }) => {
          if (!expected || expected.length === 0) return 0;
          let correct = 0;
          for (const entry of expected) {
            const noul = noulOf(output.answers[`compound_${entry.acId}`]);
            if (noul === null) continue;
            if ((noul > JEV_AC_COMPOUND_MAX_NOUL) === entry.compound) correct++;
          }
          return correct / expected.length;
        },
      }),
    ],
  },
);
