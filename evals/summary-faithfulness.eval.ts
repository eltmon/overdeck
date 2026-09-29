// E4 summary faithfulness: do summaries keep planted facts and invent nothing?
// Cases: evals/fixtures/summaries/*.json (scrubbed real-session excerpts with edited-in facts/decoys).
// Gates: Luna/Haiku/Sonnet for titles, compaction, fork summary and handoff author.
import { createScorer, evalite } from 'evalite';
import { serializeConversation } from '../src/lib/conversations/smart-compaction.js';
import { renderExternalHandoffPrompt, validateHandoffDoc } from '../src/lib/conversations/summary-fork.js';
import { SUMMARIZATION_SYSTEM_PROMPT, buildSummaryUserPrompt } from '../src/lib/conversations/summary-prompts.js';
import { buildTranscriptTitlePrompt, serializeConversationTranscript } from '../src/lib/conversations/transcript-summary.js';
import { appendEvalRecord, recordFromRun } from './lib/eval-results.js';
import { parseSummaryCase, scoreFaithfulness, type FaithfulnessScores, type SummaryCase } from './lib/faithfulness-scorer.js';
import { loadFixtureDir } from './lib/fixtures.js';
import { loadPromptFile, runPromptScenario, type PromptScenarioRun, type RunPromptScenarioOptions } from './lib/prompt-harness.js';

const cases = loadFixtureDir('evals/fixtures/summaries').map((f) => parseSummaryCase(f.data));

interface FixtureEntry {
  type?: string;
  message?: { content?: unknown };
}

/** User and assistant text turns, as the dashboard title path sees them (no tool calls or results). */
function titleMessages(entries: unknown[]): Array<{ role: 'user' | 'assistant'; text: string; sequence: number }> {
  const messages: Array<{ role: 'user' | 'assistant'; text: string; sequence: number }> = [];
  for (const raw of entries) {
    const entry = raw as FixtureEntry;
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    const content = entry.message?.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((b): b is { type: 'text'; text: string } => b?.type === 'text' && typeof b.text === 'string')
              .map((b) => b.text)
              .join('\n')
          : '';
    if (text.trim() !== '') messages.push({ role: entry.type, text, sequence: messages.length });
  }
  return messages;
}

function buildScenario(c: SummaryCase, serialized: string): RunPromptScenarioOptions {
  switch (c.kind) {
    case 'fork':
    case 'compaction':
      // Production sends system + '\n\n' + user as one claude -p prompt; splitting at that
      // boundary puts the same text in the API's system field.
      return {
        system: SUMMARIZATION_SYSTEM_PROMPT,
        user: buildSummaryUserPrompt(serialized, undefined, c.kind === 'fork'),
        maxTokens: 16_000,
      };
    case 'handoff':
      return {
        system: 'You are an authoring session spawned by Overdeck.',
        user: `${renderExternalHandoffPrompt(loadPromptFile('roles/handoff-external.md'), c.focus, serialized, '<eval: no file>')}

Eval mode: you have no tools. Output the complete handoff document as your response text instead of writing a file.`,
        maxTokens: 16_000,
      };
    case 'title':
      return {
        system: 'Respond with JSON {"title": string}.',
        user: buildTranscriptTitlePrompt(serializeConversationTranscript(titleMessages(c.entries), { purpose: 'title' })),
        maxTokens: 4_000,
      };
  }
}

type SummaryOutput = FaithfulnessScores & { docValid: 0 | 1 | null; text: string; run: PromptScenarioRun };

evalite<SummaryCase, SummaryOutput>('summary faithfulness (E4)', {
  data: cases.map((c) => ({ input: c })),
  task: async (c) => {
    // Tool-call arguments count as source, so every kind is checked against the full serialization.
    const serialized = serializeConversation(c.entries, false);
    const { text, run } = await runPromptScenario(buildScenario(c, serialized));
    const scores = scoreFaithfulness(text, c, serialized);
    const docValid: 0 | 1 | null = c.kind === 'handoff' ? (validateHandoffDoc(text).ok ? 1 : 0) : null;
    appendEvalRecord(
      recordFromRun('summary-faithfulness', c.id, run, scores.score, {
        recall: scores.recall,
        unsupported: scores.unsupported,
        decoyHits: scores.decoyHits,
        hallucinations: scores.hallucinations,
        formatValid: scores.formatValid,
        docValid,
      }),
    );
    return { ...scores, docValid, text, run };
  },
  scorers: [
    createScorer<SummaryCase, SummaryOutput>({
      name: 'faithfulness',
      description: 'Recall with the hallucination rule: handoff/compaction hard-fail, fork/title divide by (1 + hallucinations).',
      scorer: ({ output }) => output.score,
    }),
    createScorer<SummaryCase, SummaryOutput>({
      name: 'planted recall',
      description: 'Share of planted facts the summary preserves.',
      scorer: ({ output }) => output.recall,
    }),
    createScorer<SummaryCase, SummaryOutput>({
      name: 'no hallucinations',
      description: '1 when the summary has no unsupported identifiers and states no decoy as current.',
      scorer: ({ output }) => (output.hallucinations === 0 ? 1 : 0),
    }),
  ],
});
