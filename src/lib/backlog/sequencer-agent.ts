import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentState } from '../agents.js';
import { spawnRun, determineModel } from '../agents.js';
import { collectOpenBacklog } from './backlog-input.js';
import type { Issue } from '../tracker/interface.js';
import type { PassMode } from './types.js';
import type { CollectOpenBacklogResult } from './backlog-input.js';

export const SEQUENCER_AGENT_ID = 'sequencer-runner';

export type SpawnSequencerOptions = {
  projectRoot?: string;
  projectKey?: string;
  model?: string;
  workspace?: string;
  batchSize?: number;
  issues?: Issue[];
};

export async function spawnSequencerAgent(
  pass: PassMode | 'auto',
  opts: SpawnSequencerOptions = {},
): Promise<AgentState> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const projectKey = opts.projectKey ?? 'overdeck';
  const batchSize = opts.batchSize ?? 20;

  const seqPath = join(projectRoot, '.pan', 'backlog', 'sequence.md');
  const resolvedPass: PassMode =
    pass !== 'auto' ? pass : existsSync(seqPath) ? 'incremental' : 'creation';

  let issues = opts.issues;
  if (!issues) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSharedIssueService } = require('../../dashboard/server/services/issue-service-singleton.js') as
        typeof import('../../dashboard/server/services/issue-service-singleton.js');
      issues = getSharedIssueService().getIssues() as Issue[];
    } catch {
      issues = [];
    }
  }
  const input = await collectOpenBacklog(projectRoot, issues);
  const model = determineModel({ role: 'sequencer', model: opts.model });
  const prompt = buildSequencerPrompt(resolvedPass, { projectRoot, projectKey, input, batchSize });

  return spawnRun(SEQUENCER_AGENT_ID, 'sequencer', {
    agentId: SEQUENCER_AGENT_ID,
    workspace: opts.workspace ?? projectRoot,
    prompt,
    model,
    allowHost: true,
    registerConversation: true,
  });
}

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
4. Write the result via \`pan backlog write-sequence\` (see Output section below — do NOT write the file directly).
`,
    incremental: `
This is an INCREMENTAL pass — a prior sequence.md exists at ${hasPrior ? priorSequencePath : '(not found)'}. Preserve existing ranks, scores, conditions, operator-owned fields, and operator-sourced edges VERBATIM unless a delta justifies a change.

Rules:
- An issue changed since the prior run if its manifest \`updatedAt\` is LATER than the prior sequence \`generatedAt\` (${hasPrior ? priorSequence!.generatedAt : 'N/A'}). Read bodies ONLY for those issues. Batch these (${batchSize} at a time).
- A delta justifies a rank change when: body changed materially, new cross-references appeared, a dependency was closed/merged, or condition changed.
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

## Reading issue bodies

Fetch issue bodies in batches of ${batchSize} using the GitHub CLI:
  gh issue view <NUMBER> --json number,title,body

Derive NUMBER from the manifest id (e.g. PAN-42 → 42). Do NOT fetch all bodies at once; read one batch, update your running shortlist, then the next.

## Output

After completing your analysis, write the SequenceDoc JSON to a temp file and submit it via:

  pan backlog write-sequence /tmp/sequence-result.json

The \`pan backlog write-sequence\` command validates the JSON, writes the formatted
\`.pan/backlog/sequence.md\`, and queues an auto-commit — so DO NOT write the file
directly with the Write tool. Always go through this command.

The SequenceDoc JSON must conform to the schema:
  { version, project, generatedAt (ISO), model, pass, openCount, nodes[], edges[] }

where each node has: issue, rank, size (XS/S/M/L/XL), importance (critical/high/medium/low),
score (0-100), condition (ok/needs-refinement/stale), dependsOn (string[]), why (≤140 chars),
rationale (optional), gate (auto/ready/blocked), planning (skip/auto/interactive).

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
${commonRules}`;
}
