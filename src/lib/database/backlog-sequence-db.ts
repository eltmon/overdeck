import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { getDatabase } from './index.js';
import { parseSequenceMd } from '../backlog/sequence-io.js';
import type { SequenceDoc, SequenceNode } from '../backlog/types.js';

export function upsertBacklogSequence(projectKey: string, doc: SequenceDoc): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO backlog_sequence
      (project_key, issue_id, rank, size, importance, score, condition,
       depends_on, why, gate, planning, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_key, issue_id)
    DO UPDATE SET
      rank = excluded.rank,
      size = excluded.size,
      importance = excluded.importance,
      score = excluded.score,
      condition = excluded.condition,
      depends_on = excluded.depends_on,
      why = excluded.why,
      gate = excluded.gate,
      planning = excluded.planning,
      generated_at = excluded.generated_at
  `);

  const tx = db.transaction((nodes: SequenceNode[]) => {
    for (const node of nodes) {
      stmt.run(
        projectKey,
        node.issue,
        node.rank,
        node.size,
        node.importance,
        node.score,
        node.condition,
        JSON.stringify(node.dependsOn),
        node.why,
        node.gate,
        node.planning,
        doc.generatedAt,
      );
    }
  });

  tx(doc.nodes);
}

export function clearBacklogSequence(projectKey: string): void {
  getDatabase().prepare('DELETE FROM backlog_sequence WHERE project_key = ?').run(projectKey);
}

export function rebuildBacklogSequenceFromMd(projectRoot: string): void {
  const seqPath = join(projectRoot, '.pan', 'backlog', 'sequence.md');
  if (!existsSync(seqPath)) return;

  const md = readFileSync(seqPath, 'utf-8');
  const result = parseSequenceMd(md);
  if (!result.ok) {
    console.warn(`[backlog-sequence] parse error: ${result.error}`);
    return;
  }

  const projectKey = result.doc.project;
  clearBacklogSequence(projectKey);
  upsertBacklogSequence(projectKey, result.doc);
}

export function getBacklogSequenceForRoot(projectRoot: string): {
  nodes: ReturnType<typeof getBacklogSequence>;
  edges: Array<{ from: string; to: string; type: string }>;
} {
  const seqPath = join(projectRoot, '.pan', 'backlog', 'sequence.md');

  if (existsSync(seqPath)) {
    const md = readFileSync(seqPath, 'utf-8');
    const result = parseSequenceMd(md);
    if (result.ok) {
      const projectKey = result.doc.project;
      upsertBacklogSequence(projectKey, result.doc);
      return {
        nodes: getBacklogSequence(projectKey),
        edges: result.doc.edges.map((e) => ({ from: e.from, to: e.to, type: e.type })),
      };
    }
  }

  // MD absent or unparseable — fall back to any cached project
  const row = getDatabase()
    .prepare('SELECT DISTINCT project_key FROM backlog_sequence LIMIT 1')
    .get() as { project_key: string } | undefined;
  if (!row) return { nodes: [], edges: [] };
  return { nodes: getBacklogSequence(row.project_key), edges: [] };
}

export function getBacklogSequence(projectKey: string): Array<{
  issueId: string;
  rank: number;
  size: string;
  importance: string;
  score: number;
  condition: string;
  dependsOn: string[];
  why: string;
  gate: string;
  planning: string;
  generatedAt: string;
}> {
  const rows = getDatabase()
    .prepare('SELECT * FROM backlog_sequence WHERE project_key = ? ORDER BY rank ASC')
    .all(projectKey) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    issueId: r['issue_id'] as string,
    rank: r['rank'] as number,
    size: r['size'] as string,
    importance: r['importance'] as string,
    score: r['score'] as number,
    condition: r['condition'] as string,
    dependsOn: JSON.parse(r['depends_on'] as string) as string[],
    why: r['why'] as string,
    gate: r['gate'] as string,
    planning: r['planning'] as string,
    generatedAt: r['generated_at'] as string,
  }));
}
