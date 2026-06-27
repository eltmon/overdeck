import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseSequenceJson } from './types.js';
import type { SequenceDoc, SequenceEdge, SequenceNode, SequenceParseError } from './types.js';
import { queueAutoCommit } from '../pan-dir/auto-commit.js';
import { getReviewStatusSync } from '../review-status.js';

const MACHINE_MARKER = '<!-- machine-readable; do not hand-edit below this line -->';
const TOP_TIER_SIZE = 80;
const SEQUENCE_REL_PATH = '.pan/backlog/sequence.md';

export type ParseSequenceMdResult = { ok: true; doc: SequenceDoc } | SequenceParseError;

export function parseSequenceMd(markdown: string): ParseSequenceMdResult {
  const markerIdx = markdown.indexOf(MACHINE_MARKER);
  const searchText = markerIdx >= 0 ? markdown.slice(markerIdx) : markdown;

  const fenceMatch = searchText.match(/```json\s*\n([\s\S]*?)```/);
  if (!fenceMatch) {
    return { ok: false, error: 'No fenced JSON block found in sequence.md' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fenceMatch[1]);
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  return parseSequenceJson(parsed);
}

function renderTable(nodes: SequenceNode[]): string {
  const header = '| rank | issue | size | importance | condition | epic | depends-on | why |';
  const sep = '|------|-------|------|------------|-----------|------|------------|-----|';
  const rows = nodes.map((n) =>
    `| ${n.rank} | ${n.issue} | ${n.size} | ${n.importance} | ${n.condition} | ${n.isEpic ? '✓' : ''} | ${n.dependsOn.join(', ')} | ${n.why} |`
  );
  return [header, sep, ...rows].join('\n');
}

function renderRationaleSection(nodes: SequenceNode[]): string {
  const topTier = nodes.slice(0, TOP_TIER_SIZE).filter((n) => n.rationale);
  if (topTier.length === 0) return '';
  const lines = ['## Rationale detail', ''];
  for (const n of topTier) {
    lines.push(`### ${n.issue} (rank ${n.rank})`, '', n.rationale!, '');
  }
  return lines.join('\n');
}

export interface WriteSequenceMdOpts {
  /**
   * Set to true when the caller is an operator-facing route that has already
   * applied the intended field value to the doc. Skips the prior-file
   * preservation step so operators can reset gate/planning back to 'auto'.
   *
   * When false/absent (AI resequence path), prior non-'auto' operator fields
   * and in-pipeline ranks are carried forward from the on-disk file (FR-13,
   * FR-15, FR-16, FR-17).
   */
  operatorEdit?: boolean;
}

/**
 * Write sequence.md, merging operator-owned state from the prior file.
 *
 * Merge rules for AI resequence (operatorEdit absent/false):
 * - gate !== 'auto' in prior → carry forward (operator-set)
 * - planning !== 'auto' in prior → carry forward (operator-set)
 * - in-pipeline issues (live workspace or non-pending review) → carry forward rank/why/rationale
 * - edges with source === 'operator' in prior → always preserved verbatim
 *
 * For explicit operator edits (operatorEdit: true), the doc already contains
 * the correct operator-intended value; prior-preservation is skipped entirely.
 */
export function writeSequenceMd(projectRoot: string, doc: SequenceDoc, opts?: WriteSequenceMdOpts): void {
  const outPath = join(projectRoot, SEQUENCE_REL_PATH);

  // Load prior sequence for merge-preservation (AI resequence path only)
  let priorNodeMap = new Map<string, SequenceNode>();
  let priorOperatorEdges: SequenceEdge[] = [];
  if (!opts?.operatorEdit && existsSync(outPath)) {
    const priorText = readFileSync(outPath, 'utf-8');
    const prior = parseSequenceMd(priorText);
    if (prior.ok) {
      priorNodeMap = new Map(prior.doc.nodes.map((n) => [n.issue, n]));
      priorOperatorEdges = prior.doc.edges.filter((e) => e.source === 'operator');
    }
  }

  // Detect in-pipeline (pinned) issues: live workspace dir OR non-pending review status
  const workspacesDir = join(projectRoot, 'workspaces');
  const isPinned = (issueId: string): boolean => {
    const rs = getReviewStatusSync(issueId.toUpperCase());
    if (rs && rs.reviewStatus !== 'pending') return true;
    return existsSync(join(workspacesDir, `feature-${issueId.toLowerCase()}`));
  };

  // Merge operator-owned fields into each node
  const mergedNodes: SequenceNode[] = doc.nodes.map((node) => {
    const prior = priorNodeMap.get(node.issue);
    if (!prior) return node;
    // Preserve operator-set gate and planning
    const gate = prior.gate !== 'auto' ? prior.gate : node.gate;
    const planning = prior.planning !== 'auto' ? prior.planning : node.planning;
    // Preserve rank/why/rationale for pinned (in-pipeline) issues
    if (isPinned(node.issue)) {
      return { ...node, gate, planning, rank: prior.rank, why: prior.why, rationale: prior.rationale };
    }
    return { ...node, gate, planning };
  });

  // Merge operator edges: union of prior operator edges and current doc's operator edges
  // (prior ones are kept even if the sequencer dropped them; new ones from doc are added).
  const currentOperatorEdges = doc.edges.filter((e) => e.source === 'operator');
  const currentNonOperatorEdges = doc.edges.filter((e) => e.source !== 'operator');
  const operatorEdgeKeys = new Set<string>();
  const mergedOperatorEdges: SequenceEdge[] = [];
  for (const edge of [...priorOperatorEdges, ...currentOperatorEdges]) {
    const key = `${edge.from}→${edge.to}→${edge.type}`;
    if (!operatorEdgeKeys.has(key)) {
      operatorEdgeKeys.add(key);
      mergedOperatorEdges.push(edge);
    }
  }
  const mergedEdges: SequenceEdge[] = [...mergedOperatorEdges, ...currentNonOperatorEdges];

  const mergedDoc: SequenceDoc = { ...doc, nodes: mergedNodes, edges: mergedEdges };
  const sortedNodes = [...mergedDoc.nodes].sort((a, b) => a.rank - b.rank);
  const ts = mergedDoc.generatedAt;
  const header = `# Backlog Sequence\n\n_Last sequenced: ${ts} · model: ${mergedDoc.model} · open: ${mergedDoc.openCount}_\n`;
  const table = renderTable(sortedNodes);
  const rationale = renderRationaleSection(sortedNodes);
  const machineBlock = `${MACHINE_MARKER}\n\n\`\`\`json\n${JSON.stringify(mergedDoc, null, 2)}\n\`\`\`\n`;

  const parts = [header, table];
  if (rationale) parts.push(rationale);
  parts.push(machineBlock);

  const content = parts.join('\n\n');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content, 'utf-8');

  queueAutoCommit({
    projectRoot,
    paths: [SEQUENCE_REL_PATH],
    subject: `chore(state): update backlog sequence (${doc.project})`,
  });
}
