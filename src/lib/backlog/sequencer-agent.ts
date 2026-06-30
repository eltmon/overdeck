import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { AgentState } from '../agents.js';
import { Effect } from 'effect';
import {
  spawnRun,
  determineModel,
  listRunningAgentsSync,
  getAgentStateSync,
  getAgentRuntimeStateSync,
  stopAgent,
} from '../agents.js';
import { collectOpenBacklog, normalizeBacklogIssues } from './backlog-input.js';
import type { PassMode } from './types.js';
import type { CollectOpenBacklogResult } from './backlog-input.js';

export const SEQUENCER_AGENT_ID = 'sequencer-runner';

export type SequencerRunStatus = {
  alive: boolean;
  running: boolean;
  done: boolean;
  startedAt: string | null;
  doneReason: 'fresh-sequence' | 'idle' | null;
};

export type SpawnSequencerOptions = {
  projectRoot?: string;
  projectKey?: string;
  model?: string;
  workspace?: string;
  batchSize?: number;
  /**
   * Raw dashboard read-model issues (from `getSharedIssueService().getIssues()`).
   * Normalized to tracker `Issue` objects via {@link normalizeBacklogIssues}
   * before ranking — callers must NOT pre-cast to `Issue[]` (the shapes differ).
   */
  issues?: ReadonlyArray<Record<string, unknown>>;
};

export function getSequencerRunStatus(projectRoot: string): SequencerRunStatus {
  const alive = listRunningAgentsSync().some((a) => a.id === SEQUENCER_AGENT_ID && a.tmuxActive);
  const startedAt = alive ? (getAgentStateSync(SEQUENCER_AGENT_ID)?.startedAt ?? null) : null;
  const seqPath = join(projectRoot, '.pan', 'backlog', 'sequence.md');

  let freshSequence = false;
  if (alive && startedAt && existsSync(seqPath)) {
    try {
      freshSequence = statSync(seqPath).mtimeMs >= new Date(startedAt).getTime();
    } catch {
      /* stat failed */
    }
  }

  const runtimeState = alive ? getAgentRuntimeStateSync(SEQUENCER_AGENT_ID)?.state ?? null : null;
  const idle = runtimeState === 'idle' || runtimeState === 'stopped' || runtimeState === 'suspended';
  const doneReason = freshSequence ? 'fresh-sequence' : idle ? 'idle' : null;
  const done = alive && doneReason !== null;

  return {
    alive,
    running: alive && !done,
    done,
    startedAt,
    doneReason,
  };
}

export async function clearFinishedSequencerRun(
  projectRoot: string,
  stop: () => Promise<void> = () => Effect.runPromise(stopAgent(SEQUENCER_AGENT_ID)),
): Promise<SequencerRunStatus> {
  const status = getSequencerRunStatus(projectRoot);
  if (status.done) {
    await stop();
  }
  return status;
}

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

  let rawIssues = opts.issues;
  if (!rawIssues) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSharedIssueService } = require('../../dashboard/server/services/issue-service-singleton.js') as
        typeof import('../../dashboard/server/services/issue-service-singleton.js');
      rawIssues = getSharedIssueService().getIssues() as Array<Record<string, unknown>>;
    } catch {
      rawIssues = [];
    }
  }
  // Dashboard read-model issues key the human ref as `identifier` (not `ref`)
  // and carry canonical statuses; normalize to tracker `Issue` objects so the
  // backlog ranking pipeline can read `issue.ref`/`issue.state` (PAN-1866 fix).
  const allIssues = normalizeBacklogIssues(rawIssues);
  // Scope to Panopticon/overdeck issues only for now. The sequencer is a single
  // global runner; ranking every connected project's open issues (MIN/KRUX/TIN/…)
  // bloats the manifest and isn't meaningful for an overdeck-only sequence.
  // PAN-1999 generalizes this to one sequencer per project — drop the filter then.
  const issues = allIssues.filter((issue) => issue.ref.toUpperCase().startsWith('PAN-'));
  const input = await collectOpenBacklog(projectRoot, issues);

  // Write the manifest to a file and reference it from the prompt instead of
  // inlining hundreds of KB of JSON. Inlining produced a single multi-hundred-KB
  // chat message that froze the dashboard conversation panel and blew past
  // small-context models (PAN-1866). The agent reads the file with the Read tool.
  const manifestPath = join(projectRoot, '.pan', 'backlog', 'manifest.json');
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(input.manifest, null, 2), 'utf-8');

  const model = determineModel({ role: 'sequencer', model: opts.model, spawnKey: 'sequencer:global' });
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
4. Never re-rank in-pipeline issues (inPipeline=true); pin them at rank 1 or their prior rank. Leave gate=auto — do NOT set gate=ready (the gate is operator-only; in-pipeline is detected automatically).
`,
  };

  const commonRules = `
## Ranking rules (all passes)

- Rank by IMPACT toward shipping, not raw priority signal. GitHub priority and issue age are inputs, not determinants.
- Substrate-hardening first: an issue labeled \`substrate-improvement\`, \`architecture\`, or \`v1.0-required\` is at least \`high\` importance (\`critical\` if it unblocks the pipeline or other substrate work) and ranks ahead of routine feature work of equal impact — a stable substrate is the prerequisite for everything else (vision.mdx). When a substrate epic ranks high, lift its CHILDREN's ranks together (the children are what get picked). Do not rank such an issue \`low\` just because it reads as cleanup.
- NEVER re-rank in-pipeline issues (inPipeline: true in the manifest). Pin them at their rank; leave gate=auto (do NOT set gate=ready — gate is operator-only).
- Assign condition to every issue: ok / needs-refinement / stale.
- Every node's why field must be ≤ 140 characters (displayed in the ranked table).
- Write full-paragraph rationale only for the active top tier (~top 80 nodes).
- Preserve operator-owned gate and planning fields verbatim across all passes.
- Keep operator-sourced edges verbatim. Re-derive github-ref edges. Recompute ai-inferred edges as advisory with a confidence value 0.0–1.0.
- Stamp pass="${pass}" and generatedAt=<current ISO timestamp> in the output JSON.

## Epics & parent-child

- An EPIC is a container of child issues, not directly workable. The manifest flags epics with \`isEpic: true\` (derived from an \`[EPIC]\` title prefix or an \`epic\` label). On an epic's node set \`isEpic: true\`, and rank/score it by the aggregate impact of its CHILDREN — never as standalone work. Never mark an epic ready/promoted; it must not be picked up.
- Express membership with a \`contains\` edge from the epic to each child: \`{ from: <epic>, to: <child>, type: "contains", source: "github-ref", confidence: 1 }\`. Membership sources: a child's manifest \`partOf\` field ("Part of #N" in its body) AND the epic body's task-list of child issue numbers (read the epic body to confirm). Emit one \`contains\` edge per child.
- \`contains\` edges are membership, NOT ordering. Keep the children's intended BUILD ORDER in their \`dependsOn\` (and \`unblocks\` edges) as usual — an epic body often states the order explicitly.

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
  { version (number, e.g. 1), project, generatedAt (ISO), model, pass, openCount, nodes[], edges[] }

where each node has: issue, rank, size (XS/S/M/L/XL), importance (critical/high/medium/low),
score (0-100), condition (ok/needs-refinement/stale), dependsOn (string[]), why (≤140 chars),
rationale (optional), gate (auto/ready/blocked), planning (skip/auto/interactive),
isEpic (optional boolean — true for epic containers).

Each edge has: from, to, type (unblocks/informs/contains), source (github-ref/operator/ai-inferred),
confidence (0.0–1.0). Use type="contains" only for epic→child membership.

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

The manifest is written to \`.pan/backlog/manifest.json\` (relative to the project root) — it is NOT inlined here. Read it FIRST (the Read tool, or \`cat .pan/backlog/manifest.json\`) to load every open issue's { id, title, labels, priority, ageMs, inPipeline, hasPrd, ready, updatedAt, isEpic, partOf }. Do NOT ask for it to be pasted into the prompt.
${commonRules}`;
}
