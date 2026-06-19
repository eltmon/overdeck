import type { PassMode } from './types.js';
import type { CollectOpenBacklogResult } from './backlog-input.js';

export type SequencerPromptInput = {
  projectRoot: string;
  projectKey: string;
  input: CollectOpenBacklogResult;
  batchSize?: number;
};

export function buildSequencerPrompt(pass: PassMode, opts: SequencerPromptInput): string {
  const { projectRoot, projectKey, input, batchSize = 20 } = opts;
  const { manifest, bodies, priorSequence } = input;
  const hasPrior = priorSequence !== null;
  const priorSequencePath = `${projectRoot}/.pan/backlog/sequence.md`;

  const manifestJson = JSON.stringify(manifest, null, 2);

  const passInstructions = {
    creation: `
This is a CREATION pass — there is no prior sequence.md. You must rank the entire open backlog from scratch.

1. Read all issue bodies in batches of ${batchSize}. NEVER request all bodies at once — do NOT inline the entire backlog in a single prompt or tool call. Read batch 0, update your running shortlist, then batch 1, and so on.
2. Assign rank, size, importance, score, condition, gate, and planning to every issue.
3. Derive the dependency DAG from GitHub cross-references and your analysis.
4. Write the result via writeSequenceMd (or \`pan backlog write-sequence\`).
`,
    incremental: `
This is an INCREMENTAL pass — a prior sequence.md exists at ${hasPrior ? priorSequencePath : '(not found)'}. Preserve existing ranks, scores, conditions, operator-owned fields, and operator-sourced edges VERBATIM unless a delta justifies a change.

Rules:
- Read bodies ONLY for issues that changed since the prior run. Batch these (${batchSize} at a time).
- A delta justifies a change when: body changed materially, new cross-references appeared, a dependency was closed/merged, or condition changed.
- For each changed issue: set a rationale field (one sentence) explaining why the rank changed.
- Re-derive github-ref edges. Recompute ai-inferred edges as advisory. Preserve operator edges verbatim.
- Preserve operator-owned gate and planning fields verbatim.
`,
    review: `
This is a REVIEW pass — re-rank the full backlog on demand. A prior sequence.md is available at ${hasPrior ? priorSequencePath : '(not found)'} for reference.

1. Re-read all issue bodies in batches of ${batchSize}. NEVER inline the entire backlog in one prompt. Do NOT concatenate all bodies — read them batch by batch against your running shortlist.
2. Re-derive all ai-inferred and github-ref edges.
3. Preserve operator edges verbatim.
4. Never re-rank in-pipeline issues (inPipeline=true); pin them at rank 1 or their prior rank with gate=ready.
`,
  };

  const commonRules = `
## Ranking rules (all passes)

- Rank by IMPACT toward shipping, not raw priority signal. GitHub priority and issue age are inputs, not determinants.
- NEVER re-rank in-pipeline issues (inPipeline: true in the manifest). Pin them with gate=ready.
- Assign condition to every issue: ok / needs-refinement / stale.
- Every node's why field must be ≤ 140 characters (displayed in the ranked table).
- Write full-paragraph rationale only for the active top tier (~top 80 nodes).
- Preserve operator-owned gate and planning fields verbatim across all passes.
- Keep operator-sourced edges verbatim. Re-derive github-ref edges. Recompute ai-inferred edges as advisory with a confidence value 0.0–1.0.
- Stamp pass="${pass}" and generatedAt=<current ISO timestamp> in the output JSON.

## Output

After completing your analysis, write the result by calling writeSequenceMd(projectRoot, doc) from src/lib/backlog/sequence-io.ts, or run: pan backlog write-sequence --project-root ${projectRoot}

Do not ask for operator input. If an issue is ambiguous, assign condition=needs-refinement and move on.
`;

  const priorContext = hasPrior
    ? `\n## Prior sequence\n\nProject: ${priorSequence!.project}, pass: ${priorSequence!.pass}, ${priorSequence!.nodes.length} nodes, generated: ${priorSequence!.generatedAt}\n`
    : '\n## Prior sequence\n\nNo prior sequence.md found — this is the first run.\n';

  return `# Sequencer run: ${pass.toUpperCase()} pass for ${projectKey}

You are the Overdeck Sequencer. Your job is to rank the open backlog for project "${projectKey}" and write .pan/backlog/sequence.md.

## Pass
${passInstructions[pass]}
${priorContext}
## Backlog manifest (${manifest.length} open issues, ${bodies.count} bodies available in ${Math.ceil(bodies.count / batchSize)} batches of ${batchSize})

${manifestJson}

## Batched body access

Read bodies via: \`pan backlog bodies --project-root ${projectRoot} --batch <N> --batch-size ${batchSize}\`
or the equivalent API call. Do NOT concatenate all bodies. Process one batch at a time.
${commonRules}`;
}
