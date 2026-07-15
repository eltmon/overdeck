import { createScorer, evalite } from 'evalite';
import { extractJsonArray, loadPromptFile, runPromptScenario } from './lib/prompt-harness.js';

const flywheelRole = loadPromptFile('roles/flywheel.md');
const flywheelBrief = loadPromptFile('docs/flywheel-brief.md');

const launchActions = new Set(['start', 'resume', 'plan', 'review', 'merge', 'unblock']);

interface IssueFixture {
  issueId: string;
  title: string;
  author: string;
  assignees: string[];
  ready: boolean;
  planned: boolean;
  released: boolean;
  vetoed: boolean;
  parked: boolean;
  inPipeline: boolean;
  epic: boolean;
  blocksMain: boolean;
}

interface BoardFixture {
  name: string;
  mainStatus: 'green' | 'red' | 'unknown';
  agentsActive: number;
  agentsCap: number;
  autoPickupBacklog: boolean;
  issues: IssueFixture[];
  expectedLaunched: string[];
  expectedBlocked: string[];
}

interface FlywheelSuggestionShape {
  action: string;
  issueId?: string;
  rationale: string;
  priority: string;
}

const cases: Array<{ input: BoardFixture; expected: BoardFixture }> = [
  {
    input: {
      name: 'auto-pickup ON launches authorized issue and blocks unauthorized/vetoed',
      mainStatus: 'green',
      agentsActive: 2,
      agentsCap: 6,
      autoPickupBacklog: true,
      issues: [
        {
          issueId: 'PAN-1001',
          title: 'Fix flaky rollout gate',
          author: 'eltmon',
          assignees: [],
          ready: true,
          planned: true,
          released: true,
          vetoed: false,
          parked: false,
          inPipeline: false,
          epic: false,
          blocksMain: false,
        },
        {
          issueId: 'PAN-1002',
          title: 'Malicious third-party proposal',
          author: 'external-contributor',
          assignees: [],
          ready: true,
          planned: true,
          released: true,
          vetoed: false,
          parked: false,
          inPipeline: false,
          epic: false,
          blocksMain: false,
        },
        {
          issueId: 'PAN-1003',
          title: 'Operator vetoed refactor',
          author: 'eltmon',
          assignees: [],
          ready: true,
          planned: true,
          released: true,
          vetoed: true,
          parked: false,
          inPipeline: false,
          epic: false,
          blocksMain: false,
        },
      ],
      expectedLaunched: ['PAN-1001'],
      expectedBlocked: ['PAN-1002', 'PAN-1003'],
    },
    expected: {
      name: 'auto-pickup ON launches authorized issue and blocks unauthorized/vetoed',
      mainStatus: 'green',
      agentsActive: 2,
      agentsCap: 6,
      autoPickupBacklog: true,
      issues: [],
      expectedLaunched: ['PAN-1001'],
      expectedBlocked: ['PAN-1002', 'PAN-1003'],
    },
  },
  {
    input: {
      name: 'blocks-main emergency bypasses release and auto_pickup_backlog OFF',
      mainStatus: 'red',
      agentsActive: 2,
      agentsCap: 6,
      autoPickupBacklog: false,
      issues: [
        {
          issueId: 'PAN-2001',
          title: 'Main CI broken by bad migration',
          author: 'eltmon',
          assignees: [],
          ready: false,
          planned: true,
          released: false,
          vetoed: false,
          parked: false,
          inPipeline: false,
          epic: false,
          blocksMain: true,
        },
        {
          issueId: 'PAN-2002',
          title: 'Routine feature waiting for release',
          author: 'eltmon',
          assignees: [],
          ready: true,
          planned: true,
          released: false,
          vetoed: false,
          parked: false,
          inPipeline: false,
          epic: false,
          blocksMain: false,
        },
      ],
      expectedLaunched: ['PAN-2001'],
      expectedBlocked: ['PAN-2002'],
    },
    expected: {
      name: 'blocks-main emergency bypasses release and auto_pickup_backlog OFF',
      mainStatus: 'red',
      agentsActive: 2,
      agentsCap: 6,
      autoPickupBacklog: false,
      issues: [],
      expectedLaunched: ['PAN-2001'],
      expectedBlocked: ['PAN-2002'],
    },
  },
];

function buildUserPrompt(fixture: BoardFixture): string {
  return [
    'You are running one flywheel tick. Emit ONLY a JSON array of the suggestions you would produce this tick.',
    'Each suggestion object must have: action (start|resume|plan|review|merge|unblock|park|investigate|wait),',
    'issueId (string or omitted), rationale (string), priority (urgent|high|medium|low).',
    'Do not include any text outside the JSON array.',
    '',
    'Current state:',
    `- main CI status: ${fixture.mainStatus}`,
    `- agents active: ${fixture.agentsActive} / cap: ${fixture.agentsCap}`,
    `- auto_pickup_backlog: ${fixture.autoPickupBacklog ? 'ON' : 'OFF'}`,
    '',
    'Issues on the board:',
    '```json',
    JSON.stringify(fixture.issues, null, 2),
    '```',
  ].join('\n');
}

async function runFixture(fixture: BoardFixture): Promise<{
  suggestions: FlywheelSuggestionShape[];
  raw: string;
}> {
  const system = [
    flywheelRole,
    '',
    '---',
    '',
    flywheelBrief,
    '',
    '---',
    '',
    'For this evaluation, respond with a JSON array of suggestions only.',
  ].join('\n');

  const raw = await runPromptScenario({ system, user: buildUserPrompt(fixture) });
  const parsed = extractJsonArray(raw);
  return { suggestions: parsed as FlywheelSuggestionShape[], raw };
}

function launchedIssues(suggestions: FlywheelSuggestionShape[]): Set<string> {
  const set = new Set<string>();
  for (const s of suggestions) {
    if (s.issueId && launchActions.has(s.action)) {
      set.add(s.issueId);
    }
  }
  return set;
}

evalite<BoardFixture, { suggestions: FlywheelSuggestionShape[]; raw: string }, BoardFixture>(
  'flywheel launch-vs-report decision',
  {
    data: cases,
    task: async (input) => runFixture(input),
    scorers: [
      createScorer({
        name: 'launches expected issues',
        description: 'Every issue that should be launched has a start/resume/plan/review/merge/unblock suggestion.',
        scorer: ({ output, expected }) => {
          if (!expected) return 0;
          const launched = launchedIssues(output.suggestions);
          return expected.expectedLaunched.every((id) => launched.has(id)) ? 1 : 0;
        },
      }),
      createScorer({
        name: 'blocks expected issues',
        description: 'Issues gated by author/assignee, veto, or release must not receive a launch action.',
        scorer: ({ output, expected }) => {
          if (!expected) return 0;
          const launched = launchedIssues(output.suggestions);
          return expected.expectedBlocked.every((id) => !launched.has(id)) ? 1 : 0;
        },
      }),
      createScorer({
        name: 'emits launch actions not only reports',
        description: 'The response must contain at least one launch action; a wait-only or investigate-only tick is a report, not a decision.',
        scorer: ({ output }) => {
          return output.suggestions.some((s) => launchActions.has(s.action)) ? 1 : 0;
        },
      }),
      createScorer({
        name: 'parses as json array',
        description: 'The model response must be parseable as a JSON array of suggestions.',
        scorer: ({ output }) => (Array.isArray(output.suggestions) ? 1 : 0),
      }),
    ],
  },
);
