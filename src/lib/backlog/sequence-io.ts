import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseSequenceJson } from './types.js';
import type { SequenceDoc, SequenceNode, SequenceParseError } from './types.js';
import { queueAutoCommit } from '../pan-dir/auto-commit.js';

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
  const header = '| rank | issue | size | importance | condition | depends-on | why |';
  const sep = '|------|-------|------|------------|-----------|------------|-----|';
  const rows = nodes.map((n) =>
    `| ${n.rank} | ${n.issue} | ${n.size} | ${n.importance} | ${n.condition} | ${n.dependsOn.join(', ')} | ${n.why} |`
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

export function writeSequenceMd(projectRoot: string, doc: SequenceDoc): void {
  const sortedNodes = [...doc.nodes].sort((a, b) => a.rank - b.rank);
  const ts = doc.generatedAt;
  const header = `# Backlog Sequence\n\n_Last sequenced: ${ts} · model: ${doc.model} · open: ${doc.openCount}_\n`;
  const table = renderTable(sortedNodes);
  const rationale = renderRationaleSection(sortedNodes);
  const machineBlock = `${MACHINE_MARKER}\n\n\`\`\`json\n${JSON.stringify(doc, null, 2)}\n\`\`\`\n`;

  const parts = [header, table];
  if (rationale) parts.push(rationale);
  parts.push(machineBlock);

  const content = parts.join('\n\n');
  const outPath = join(projectRoot, SEQUENCE_REL_PATH);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content, 'utf-8');

  queueAutoCommit({
    projectRoot,
    paths: [SEQUENCE_REL_PATH],
    subject: `chore(state): update backlog sequence (${doc.project})`,
  });
}
