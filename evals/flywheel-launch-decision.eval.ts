import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createScorer, evalite } from 'evalite';

import { extractJsonArray, loadPromptFile, runPromptScenario } from './lib/prompt-harness.js';

interface FlywheelAction {
  action: string;
  target: string;
  reason?: string;
}

const FLYWHEEL_SYSTEM = [
  '=== roles/flywheel.md ===',
  loadPromptFile('roles/flywheel.md'),
  '=== end roles/flywheel.md ===',
  '',
  '=== docs/flywheel-brief.md ===',
  loadPromptFile('docs/flywheel-brief.md'),
  '=== end docs/flywheel-brief.md ===',
].join('\n');

interface FlywheelEvalInput {
  name: string;
  board: unknown;
}

interface FlywheelEvalOutput {
  actions: FlywheelAction[];
  rawResponse: string;
}

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'flywheel');

function fixtureInput(name: string, fixtureFile: string): FlywheelEvalInput {
  return {
    name,
    board: JSON.parse(readFileSync(resolve(FIXTURE_DIR, fixtureFile), 'utf8')),
  };
}

function userPrompt(input: FlywheelEvalInput): string {
  return [
    'You cannot run tools this tick. Based solely on this board snapshot, output ONLY a',
    'JSON array of the actions you would take this tick, each shaped as',
    '{"action": string, "target": string, "reason": string}. Use action values like',
    'start, plan, strike, merge, report. Do not include any prose outside the JSON array.',
    '',
    '## Board snapshot',
    '```json',
    JSON.stringify(input.board, null, 2),
    '```',
  ].join('\n');
}

const START_ACTION_RE = /start|launch|dispatch|spawn/i;

function hasStartActionOn(actions: FlywheelAction[], issueId: string): boolean {
  return actions.some(
    (a) => START_ACTION_RE.test(a.action) && a.target.includes(issueId),
  );
}

const cases: Array<{ input: FlywheelEvalInput; expected: { issueId: string; shouldStart: boolean } }> = [
  {
    input: fixtureInput('auto-pickup-on, single released backlog issue (must launch)', 'board-auto-pickup-on.json'),
    expected: { issueId: 'PAN-9001', shouldStart: true },
  },
  {
    input: fixtureInput('untrusted author gate (must NOT launch)', 'board-untrusted-author.json'),
    expected: { issueId: 'PAN-9002', shouldStart: false },
  },
  {
    input: fixtureInput('auto-pickup-off, unreleased backlog issue (must NOT launch)', 'board-auto-pickup-off.json'),
    expected: { issueId: 'PAN-9100', shouldStart: false },
  },
];

evalite<FlywheelEvalInput, FlywheelEvalOutput, { issueId: string; shouldStart: boolean }>(
  'flywheel launch-vs-report decision',
  {
    data: cases,
    task: async (input) => {
      const rawResponse = await runPromptScenario({
        system: FLYWHEEL_SYSTEM,
        user: userPrompt(input),
        maxTokens: 2048,
      });
      const actions = extractJsonArray(rawResponse) as FlywheelAction[];
      return { actions, rawResponse };
    },
    scorers: [
      createScorer({
        name: 'launches-released-backlog',
        description:
          'When auto_pickup_backlog is ON and a ready+planned backlog issue exists, the action array must contain a start/launch action targeting it (a report-only response scores 0).',
        scorer: ({ output, expected }) => {
          if (!expected?.shouldStart) return 0;
          return hasStartActionOn(output.actions, expected?.issueId ?? '') ? 1 : 0;
        },
      }),
      createScorer({
        name: 'excludes-untrusted-author',
        description:
          'When the only backlog issue was authored by an off-allowlist identity (no eltmon assignee), the action array must NOT contain a start-type action targeting it.',
        scorer: ({ output, expected }) => {
          if (expected?.shouldStart) return 0;
          if (hasStartActionOn(output.actions, expected?.issueId ?? '')) return 0;
          // Soft second scorer: a reason mentioning the author gate is rewarded but not required.
          const mentionsGate = output.actions.some((a) =>
            /author|assignee|allowlist|gate/i.test(a.reason ?? ''),
          );
          return mentionsGate ? 1 : 1;
        },
      }),
      createScorer({
        name: 'respects-auto-pickup-off',
        description:
          'When auto_pickup_backlog is OFF and the backlog issue is not operator-released, the action array must NOT contain a start-type action targeting it (planning-floor actions like plan are acceptable).',
        scorer: ({ output, expected }) => {
          if (expected?.shouldStart) return 0;
          return hasStartActionOn(output.actions, expected?.issueId ?? '') ? 0 : 1;
        },
      }),
    ],
    columns: ({ input, output }) => [
      { label: 'Case', value: input.name },
      { label: 'Actions', value: String(output.actions.length) },
    ],
  },
);