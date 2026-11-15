import { copyFileSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseSequenceJson } from './types.js';
import type { SequenceDoc, SequenceEdge, SequenceNode, SequenceParseError } from './types.js';
import { getProjectPanPaths } from '../pan-dir/specs.js';

const MACHINE_MARKER = '<!-- machine-readable; do not hand-edit below this line -->';
const TOP_TIER_SIZE = 80;
function sequencePath(projectRoot: string): string {
  return join(getProjectPanPaths(projectRoot).panDir, 'backlog', 'sequence.md');
}

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

/** PAN-5357: deterministic node order so array order never changes the rendered bytes. */
function sortNodes(nodes: SequenceNode[]): SequenceNode[] {
  return [...nodes].sort(
    (a, b) => a.rank - b.rank || a.issue.localeCompare(b.issue) || JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
}

/** PAN-5357: deterministic edge order so array order never changes the rendered bytes. */
function sortEdges(edges: SequenceEdge[]): SequenceEdge[] {
  const key = (e: SequenceEdge): string => `${e.from}\u0000${e.to}\u0000${e.type}\u0000${e.source}`;
  return [...edges].sort((a, b) => key(a).localeCompare(key(b)) || a.confidence - b.confidence);
}

/** PAN-5357: the full sequence.md rendering, as a pure function of the doc. */
function renderSequenceMd(doc: SequenceDoc): string {
  const sortedNodes = sortNodes(doc.nodes);
  const canonical: SequenceDoc = { ...doc, nodes: sortedNodes, edges: sortEdges(doc.edges) };
  const header = `# Backlog Sequence\n\n_Last sequenced: ${doc.generatedAt} · model: ${doc.model} · open: ${doc.openCount}_\n`;
  const table = renderTable(sortedNodes);
  const rationale = renderRationaleSection(sortedNodes);
  const machineBlock = `${MACHINE_MARKER}\n\n\`\`\`json\n${JSON.stringify(canonical, null, 2)}\n\`\`\`\n`;

  const parts = [header, table];
  if (rationale) parts.push(rationale);
  parts.push(machineBlock);

  return parts.join('\n\n');
}

/**
 * PAN-5357 FR-11: the submission path records which manifest it ranked, so the
 * auto-trigger can tell "nothing changed since the last submitted pass" from
 * "nothing changed since the last spawn attempt". Operator edits never call this.
 */
function recordExaminedManifest(outPath: string): void {
  const manifestPath = join(dirname(outPath), 'manifest.json');
  if (existsSync(manifestPath)) copyFileSync(manifestPath, join(dirname(outPath), 'examined-manifest.json'));
}

export interface WriteSequenceMdResult {
  written: boolean;
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
export function writeSequenceMd(projectRoot: string, doc: SequenceDoc, opts?: WriteSequenceMdOpts): WriteSequenceMdResult {
  const outPath = sequencePath(projectRoot);

  // PAN-5357: read the prior file once, whatever opts?.operatorEdit is, so the
  // change-detection below can compare against it either way.
  const priorText = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : null;
  const priorParsed = priorText !== null ? parseSequenceMd(priorText) : null;

  // Load prior sequence for merge-preservation (AI resequence path only)
  let priorNodeMap = new Map<string, SequenceNode>();
  let priorOperatorEdges: SequenceEdge[] = [];
  if (!opts?.operatorEdit && priorParsed?.ok) {
    priorNodeMap = new Map(priorParsed.doc.nodes.map((n) => [n.issue, n]));
    priorOperatorEdges = priorParsed.doc.edges.filter((e) => e.source === 'operator');
  }

  // Detect in-pipeline (pinned) issues: an issue with a live workspace is
  // already being worked and must keep its rank. PAN-3917 removed the second
  // signal (a stored non-pending review status); the workspace directory is
  // git's own evidence that work started.
  const workspacesDir = join(projectRoot, 'workspaces');
  const isPinned = (issueId: string): boolean =>
    existsSync(join(workspacesDir, `feature-${issueId.toLowerCase()}`));

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

  // PAN-5357 FR-2: if the only difference from the prior file is generatedAt,
  // skip the write so an unchanged ranking produces nothing for git to commit.
  if (priorText !== null && priorParsed?.ok) {
    const sameButTimestamp = renderSequenceMd({ ...mergedDoc, generatedAt: priorParsed.doc.generatedAt });
    if (sameButTimestamp === priorText) {
      if (!opts?.operatorEdit) {
        // FR-3: bump mtime so getSequencerRunStatus still sees a fresh sequence.
        const now = new Date();
        utimesSync(outPath, now, now);
        recordExaminedManifest(outPath);
      }
      return { written: false };
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderSequenceMd(mergedDoc), 'utf-8');
  if (!opts?.operatorEdit) recordExaminedManifest(outPath);
  return { written: true };
}
