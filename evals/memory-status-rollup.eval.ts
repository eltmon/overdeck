import { createScorer, evalite } from 'evalite';
import type { MemoryObservation, MemoryStatus, PendingTurn } from '@overdeck/contracts';

import {
  synthesizeStatusRollup,
  type StatusRollupExtractCall,
  type SynthesizeStatusRollupResult,
} from '../src/lib/memory/rollup.js';

const identity = {
  projectId: 'overdeck',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
  runId: 'run-memory-eval',
  sessionId: 'session-memory-eval',
  agentRole: 'work',
  agentHarness: 'claude-code',
} as const;

interface RollupEvalInput {
  name: string;
  observations: MemoryObservation[];
  archivedStatuses: MemoryStatus[];
  pendingTurns: PendingTurn[];
  capturedProviderOutput: MemoryStatus;
}

interface RollupEvalExpected {
  phase: MemoryStatus['phase'];
  workingSetIncludes: string[];
  workingSetExcludes: string[];
  openIncludes: string[];
  nextStepsIncludes: string[];
}

interface RollupEvalOutput {
  result: SynthesizeStatusRollupResult;
  prompt: string;
}

function observation(input: {
  id: string;
  minute: number;
  actionStatus: string;
  summary: string;
  narrative: string;
  files: string[];
  tags: string[];
}): MemoryObservation {
  return {
    id: input.id,
    timestamp: `2026-05-16T20:${String(input.minute).padStart(2, '0')}:00.000Z`,
    ...identity,
    gitBranch: 'feature/pan-1052',
    sourceTranscriptOffset: input.minute,
    actionStatus: input.actionStatus,
    narrative: input.narrative,
    summary: input.summary,
    files: input.files,
    tags: input.tags,
    tokens: { prompt: 120, completion: 40, total: 160 },
    model: 'claude-haiku-4-5-20251001',
  };
}

function pendingTurn(input: {
  id: string;
  minute: number;
  compressedText: string;
}): PendingTurn {
  return {
    id: input.id,
    createdAt: `2026-05-16T21:${String(input.minute).padStart(2, '0')}:00.000Z`,
    identity,
    trigger: 'stop-hook',
    transcriptPath: `/tmp/${input.id}.jsonl`,
    fromOffset: input.minute * 10,
    toOffset: input.minute * 10 + 9,
    lastFullLineOffset: input.minute * 10 + 9,
    eventsConsumed: 8,
    compressedText: input.compressedText,
  };
}

const staleStatus: MemoryStatus = {
  name: 'Old dashboard cleanup',
  headline: 'Dashboard CSS cleanup is underway.',
  summary: 'The previous cycle focused on dashboard visual fixes.',
  goal: 'Clean up a stale dashboard card layout',
  phase: 'building',
  accomplished: ['Inspected dashboard CSS'],
  decided: ['Keep old card shell temporarily'],
  open: ['Verify dashboard screenshot'],
  nextSteps: ['Edit dashboard CSS'],
  confidence: 0.72,
  workingSet: ['src/dashboard/frontend/src/components/CommandDeck/styles/command-deck.module.css'],
  tags: ['dashboard'],
};

const memoryRollupOutput: MemoryStatus = {
  name: 'Memory status rollup foundation',
  headline: 'Memory rollup is ready for verification.',
  summary: 'The rollup prompt, structured schema validation, and pending-turn commit path are implemented; the remaining risk is validating malformed provider retries.',
  goal: 'Ship PAN-1052 memory status rollups without stale working-set carryover',
  phase: 'verifying',
  accomplished: [
    'Implemented buildStatusRollupPrompt in src/lib/memory/rollup.ts',
    'Added schema validation and retry handling for malformed provider output',
  ],
  decided: ['Status rollups replace previous state instead of appending to it'],
  open: ['Malformed provider retry behavior still needs a focused test'],
  nextSteps: ['Run npm test -- tests/lib/memory/rollup.test.ts'],
  confidence: 0.84,
  workingSet: ['src/lib/memory/rollup.ts', 'tests/lib/memory/rollup.test.ts'],
  tags: ['memory', 'rollup', 'verification'],
};

const reviewResponseOutput: MemoryStatus = {
  name: 'Review response for convoy synthesis',
  headline: 'Review response is blocked on one requirements finding.',
  summary: 'The reviewer reports were read and the response plan centers on fixing the missing no-loss audit before requesting another review.',
  goal: 'Address review findings for the convoy synthesis change',
  phase: 'planning',
  accomplished: ['Read correctness and requirements reviewer reports'],
  decided: ['Treat the missing no-loss audit as blocking'],
  open: ['No-loss audit for old review status commands is missing'],
  nextSteps: ['Add a focused no-loss audit test before changing review status rendering'],
  confidence: 0.79,
  workingSet: ['roles/review.md', 'tests/lib/cloister/review-agent.test.ts'],
  tags: ['review', 'requirements', 'no-loss-audit'],
};

const cases: Array<{ input: RollupEvalInput; expected: RollupEvalExpected }> = [
  {
    input: {
      name: 'drops stale dashboard working set during memory verification',
      archivedStatuses: [staleStatus],
      observations: [
        observation({
          id: 'obs-rollup-prompt',
          minute: 11,
          actionStatus: 'Implemented rollup prompt',
          summary: 'Added buildStatusRollupPrompt with archived statuses, recent observations, and pending turns.',
          narrative: 'The agent edited the memory rollup prompt so the model sees current evidence and replacement guidance.',
          files: ['src/lib/memory/rollup.ts'],
          tags: ['memory', 'prompt'],
        }),
        observation({
          id: 'obs-rollup-test',
          minute: 14,
          actionStatus: 'Added rollup tests',
          summary: 'Covered malformed provider retry behavior and stale working-set replacement.',
          narrative: 'The agent added tests showing the rollup retries malformed provider output and does not carry stale files forward.',
          files: ['tests/lib/memory/rollup.test.ts'],
          tags: ['memory', 'tests'],
        }),
      ],
      pendingTurns: [
        pendingTurn({
          id: 'pending-rollup-verify',
          minute: 1,
          compressedText: [
            'U: Run the memory rollup tests and verify the malformed retry path.',
            'A: Prepared the command npm test -- tests/lib/memory/rollup.test.ts and noted the remaining verification step.',
          ].join('\n'),
        }),
      ],
      capturedProviderOutput: memoryRollupOutput,
    },
    expected: {
      phase: 'verifying',
      workingSetIncludes: ['src/lib/memory/rollup.ts', 'tests/lib/memory/rollup.test.ts'],
      workingSetExcludes: ['src/dashboard/frontend/src/components/CommandDeck/styles/command-deck.module.css'],
      openIncludes: ['Malformed provider retry behavior still needs a focused test'],
      nextStepsIncludes: ['Run npm test -- tests/lib/memory/rollup.test.ts'],
    },
  },
  {
    input: {
      name: 'preserves blocking review response context',
      archivedStatuses: [],
      observations: [
        observation({
          id: 'obs-review-reports',
          minute: 22,
          actionStatus: 'Read reviewer reports',
          summary: 'Correctness passed but requirements flagged a missing no-loss audit.',
          narrative: 'The agent inspected reviewer output and identified the requirements blocker as the next unit of work.',
          files: ['roles/review.md'],
          tags: ['review', 'requirements'],
        }),
        observation({
          id: 'obs-review-plan',
          minute: 25,
          actionStatus: 'Planned audit test',
          summary: 'Chose to add a no-loss audit test before changing review status rendering.',
          narrative: 'The response plan keeps the old review commands accounted for before touching presentation code.',
          files: ['tests/lib/cloister/review-agent.test.ts'],
          tags: ['review', 'tests'],
        }),
      ],
      pendingTurns: [
        pendingTurn({
          id: 'pending-review-response',
          minute: 2,
          compressedText: [
            'U: Fix every blocking review finding before requesting review again.',
            'A: Identified the missing no-loss audit as blocking and prepared the next test edit.',
          ].join('\n'),
        }),
      ],
      capturedProviderOutput: reviewResponseOutput,
    },
    expected: {
      phase: 'planning',
      workingSetIncludes: ['roles/review.md', 'tests/lib/cloister/review-agent.test.ts'],
      workingSetExcludes: [],
      openIncludes: ['No-loss audit for old review status commands is missing'],
      nextStepsIncludes: ['Add a focused no-loss audit test before changing review status rendering'],
    },
  },
];

function capturedExtract(input: RollupEvalInput, promptSink: { value: string }): StatusRollupExtractCall {
  return async (prompt) => {
    promptSink.value = prompt;
    return {
      status: 'extracted',
      provider: 'captured',
      result: {
        data: input.capturedProviderOutput,
        usage: { input: 900, output: 260 },
        cost: { usd: 0 },
        model: 'captured-memory-rollup-output',
        provider: 'captured',
      },
    };
  };
}

function synthesizedStatus(output: RollupEvalOutput): MemoryStatus | null {
  return output.result.status === 'synthesized' ? output.result.memoryStatus : null;
}

function includesAll(values: readonly string[], expected: readonly string[]): boolean {
  return expected.every((item) => values.includes(item));
}

evalite<RollupEvalInput, RollupEvalOutput, RollupEvalExpected>('memory status rollup synthesis', {
  data: cases,
  task: async (input) => {
    const promptSink = { value: '' };
    const result = await synthesizeStatusRollup({
      projectId: identity.projectId,
      issueId: identity.issueId,
      pendingTurns: input.pendingTurns,
      observations: input.observations,
      archivedStatuses: input.archivedStatuses,
      extract: capturedExtract(input, promptSink),
    });
    return { result, prompt: promptSink.value };
  },
  scorers: [
    createScorer({
      name: 'valid structured status',
      description: 'The LLM-shaped output must pass MemoryStatus schema validation.',
      scorer: ({ output }) => output.result.status === 'synthesized' ? 1 : 0,
    }),
    createScorer({
      name: 'phase matches evidence',
      description: 'The synthesized phase must match the expected workflow phase for the evidence.',
      scorer: ({ output, expected }) => synthesizedStatus(output)?.phase === expected?.phase ? 1 : 0,
    }),
    createScorer({
      name: 'working set recall',
      description: 'The current files from observations must be present in workingSet.',
      scorer: ({ output, expected }) => {
        const status = synthesizedStatus(output);
        if (!status || !expected) return 0;
        return includesAll(status.workingSet, expected.workingSetIncludes) ? 1 : 0;
      },
    }),
    createScorer({
      name: 'stale working set removed',
      description: 'Files from stale archived statuses must not be carried forward without current evidence.',
      scorer: ({ output, expected }) => {
        const status = synthesizedStatus(output);
        if (!status || !expected) return 0;
        return expected.workingSetExcludes.every((file) => !status.workingSet.includes(file)) ? 1 : 0;
      },
    }),
    createScorer({
      name: 'open blockers preserved',
      description: 'Open issues from the current evidence must survive the rollup.',
      scorer: ({ output, expected }) => {
        const status = synthesizedStatus(output);
        if (!status || !expected) return 0;
        return includesAll(status.open, expected.openIncludes) ? 1 : 0;
      },
    }),
    createScorer({
      name: 'next step preserved',
      description: 'The rollup must preserve the immediate next action.',
      scorer: ({ output, expected }) => {
        const status = synthesizedStatus(output);
        if (!status || !expected) return 0;
        return includesAll(status.nextSteps, expected.nextStepsIncludes) ? 1 : 0;
      },
    }),
    createScorer({
      name: 'prompt includes replacement guidance',
      description: 'The prompt sent to the provider must tell the model to replace stale status.',
      scorer: ({ output }) => output.prompt.includes('fresh replacement, not a cumulative append-only summary') ? 1 : 0,
    }),
  ],
  columns: ({ input, output }) => [
    { label: 'Case', value: input.name },
    { label: 'Status', value: output.result.status },
    { label: 'Phase', value: synthesizedStatus(output)?.phase ?? 'none' },
  ],
});
