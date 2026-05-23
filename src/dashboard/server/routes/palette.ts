/**
 * Palette route module — Ctrl+K unified search.
 *
 * Phase 1 (this file):
 *   GET /api/palette/commands       → curated `pan` command catalog (static)
 *   GET /api/palette/search?q=&limit= → memory FTS fanout across all projects
 *
 * Phase 2 (tracked separately) will add semantic conversation indexing with
 * excerpts pointing to the relevant message inside a JSONL session. The
 * keyword-only conversation surface is intentionally NOT included here so
 * we don't ship a half-built semantic-search story; that work needs its
 * own embedding pipeline and config (see linked GitHub issue at end of
 * commit).
 */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import { listProjectsSync } from '../../../lib/projects.js';
import { runMemoryFtsStatement } from '../../../lib/memory/fts-db.js';
import { buildMatchQuery } from '../../../lib/memory/search.js';

// ─── Pan command catalog ──────────────────────────────────────────────────────
//
// Curated subset of top-level `pan <verb>` commands surfaced in the palette.
// Keep entries short; the palette filters by name/description/keywords. When
// adding/removing a top-level command in src/cli/index.ts, update this list.

interface PanCommandEntry {
  name: string;
  description: string;
  group: string;
  keywords?: string[];
}

const PAN_COMMANDS: PanCommandEntry[] = [
  // Orchestration / lifecycle
  { name: 'pan up', description: 'Start the Panopticon dashboard on port 3010', group: 'Orchestration', keywords: ['start', 'serve', 'dashboard'] },
  { name: 'pan down', description: 'Stop the Panopticon dashboard', group: 'Orchestration', keywords: ['stop', 'shutdown'] },
  { name: 'pan dev', description: 'Run dashboard in development mode (Vite HMR + tsx watch)', group: 'Orchestration', keywords: ['vite', 'hot', 'reload'] },
  { name: 'pan reload', description: 'Build then restart the dashboard only on success', group: 'Orchestration', keywords: ['rebuild', 'restart'] },
  { name: 'pan restart', description: 'Restart the dashboard (preserves sidecars)', group: 'Orchestration', keywords: ['bounce'] },
  { name: 'pan status', description: 'Show running agents and system health overview', group: 'Orchestration', keywords: ['overview', 'agents', 'list'] },
  { name: 'pan doctor', description: 'Check dependencies, configuration, and system health', group: 'Orchestration', keywords: ['health', 'check', 'diagnose'] },

  // Issue lifecycle
  { name: 'pan issues', description: 'List and triage work across connected trackers', group: 'Issues', keywords: ['list', 'tickets'] },
  { name: 'pan show <id>', description: 'Show agent state, work history, context, or health for an issue', group: 'Issues', keywords: ['inspect', 'detail'] },
  { name: 'pan triage', description: 'Triage backlog with priority + complexity heuristics', group: 'Issues' },
  { name: 'pan plan <id>', description: 'Plan an issue (interactive vBRIEF + beads)', group: 'Issues', keywords: ['planning', 'vbrief'] },
  { name: 'pan plan <id> --auto', description: 'Plan an issue non-interactively (auto mode)', group: 'Issues', keywords: ['planning', 'auto'] },

  // Work agents
  { name: 'pan start <id>', description: 'Spawn a work agent for an issue in its own tmux session', group: 'Agents', keywords: ['spawn', 'run', 'work'] },
  { name: 'pan tell <id> <msg>', description: 'Send a message to a running agent (load-buffer + paste)', group: 'Agents', keywords: ['message', 'prompt'] },
  { name: 'pan kill <id>', description: 'Stop a running agent (workspace + branch preserved)', group: 'Agents', keywords: ['stop'] },
  { name: 'pan pause <id>', description: 'Persistently pause an agent and stop it if running', group: 'Agents' },
  { name: 'pan unpause <id>', description: 'Clear an agent pause gate without spawning', group: 'Agents' },
  { name: 'pan untroubled <id>', description: 'Clear an agent troubled gate + failure counters', group: 'Agents' },
  { name: 'pan resume <id>', description: 'Resume a paused or stopped agent', group: 'Agents' },
  { name: 'pan recover [id]', description: 'Re-attach to an orphaned agent tmux session', group: 'Agents', keywords: ['attach', 'orphan'] },
  { name: 'pan sync-main <id>', description: 'Merge latest main into the feature branch for an active workspace', group: 'Agents', keywords: ['rebase', 'merge', 'main'] },
  { name: 'pan done <id>', description: 'Mark work complete and signal the review pipeline', group: 'Agents', keywords: ['complete', 'finish'] },
  { name: 'pan wipe <id>', description: 'Destructive reset to Todo (removes workspace, branches, beads, status)', group: 'Agents', keywords: ['destroy', 'reset', 'danger'] },
  { name: 'pan swarm <id>', description: 'Spawn a parallel convoy of work agents on the same issue', group: 'Agents', keywords: ['convoy', 'parallel'] },

  // Review pipeline
  { name: 'pan review pending', description: 'List PRs awaiting review action', group: 'Review' },
  { name: 'pan review request <id>', description: 'Re-request review on an issue', group: 'Review' },
  { name: 'pan review reset <id>', description: 'Reset review state for an issue', group: 'Review' },
  { name: 'pan review abort <id>', description: 'Abort an in-flight review cycle', group: 'Review' },
  { name: 'pan review restart <id>', description: 'Restart review with optional model override', group: 'Review' },

  // Memory
  { name: 'pan memory search <q>', description: 'Search Panopticon memory observations across an issue/project', group: 'Memory', keywords: ['observations', 'fts', 'find'] },
  { name: 'pan memory status', description: 'Show memory pipeline status (rollup, extraction, health)', group: 'Memory' },
  { name: 'pan memory health', description: 'Memory pipeline health snapshot', group: 'Memory' },
  { name: 'pan memory reset', description: 'Insert a memory reset marker for a scope', group: 'Memory' },
  { name: 'pan memory rollup', description: 'Generate a daily summary from pending observations', group: 'Memory' },

  // Workspace
  { name: 'pan workspace', description: 'Manage workspaces (create, destroy, list, repair)', group: 'Workspace' },
  { name: 'pan workspace rebuild <id>', description: 'Rebuild a workspace stack (Docker, deps)', group: 'Workspace' },
  { name: 'pan workspace deep-clean', description: 'Deep-clean stale workspaces + Docker resources', group: 'Workspace' },
  { name: 'pan workspace reap', description: 'Reap orphaned workspaces no longer tied to an issue', group: 'Workspace' },

  // Skills / install / sync
  { name: 'pan install', description: 'Install Panopticon prerequisites', group: 'Setup' },
  { name: 'pan init', description: 'Initialize Panopticon in the current project', group: 'Setup' },
  { name: 'pan sync', description: 'Sync skills + agents from devroot into ~/.claude/', group: 'Setup', keywords: ['skills', 'agents'] },
  { name: 'pan skills', description: 'List, install, and manage skills', group: 'Setup' },

  // Backup
  { name: 'pan backup list', description: 'List Panopticon backups', group: 'Backup' },
  { name: 'pan backup clean', description: 'Remove old backups beyond retention', group: 'Backup' },
  { name: 'pan restore [timestamp]', description: 'Restore Panopticon state from a backup', group: 'Backup' },

  // Release
  { name: 'pan release stable --version X.Y.Z', description: 'Cut a stable @panctl/* release (bump + tag + notes)', group: 'Release', keywords: ['publish', 'tag', 'version'] },
  { name: 'pan release canary', description: 'Cut a canary release', group: 'Release' },

  // Flywheel + close-out
  { name: 'pan flywheel', description: 'Start, pause, resume, inspect Fix-All Flywheel orchestrator', group: 'Flywheel', keywords: ['orchestrator', 'all', 'fixall'] },
  { name: 'pan close <id>', description: 'Close-out ceremony for a completed and merged issue', group: 'Flywheel', keywords: ['complete', 'archive'] },
  { name: 'pan approve <id>', description: 'Approve a reviewed PR for the merge step', group: 'Flywheel' },
  { name: 'pan reopen <id>', description: 'Re-enter the pipeline for a closed/cancelled issue', group: 'Flywheel' },

  // Misc
  { name: 'pan fork <conv>', description: 'Fork a Panopticon conversation into a new branch session', group: 'Conversations' },
  { name: 'pan unarchive-conversation <query>', description: 'Restore an archived Panopticon conversation', group: 'Conversations' },
  { name: 'pan cost', description: 'Token + dollar cost report for recent runs', group: 'Reporting', keywords: ['spend', 'tokens'] },
  { name: 'pan resources', description: 'RAM usage by agents, conversations, and system processes', group: 'Reporting', keywords: ['ram', 'memory', 'cpu'] },
];

// ─── Memory search row shape ──────────────────────────────────────────────────

interface MemoryFtsSnippetRow {
  rowid: number;
  display_content: string;
  doc_type: string;
  source: string;
  project_id: string;
  workspace_id: string;
  issue_id: string;
  entry_date: string;
  entry_time: string;
  tags: string;
  excerpt: string;
  bm25: number;
}

export interface PaletteSearchHit {
  kind: 'memory' | 'observation' | 'summary';
  id: string;
  projectId: string;
  workspaceId: string;
  issueId: string;
  timestamp: string;
  displayContent: string;
  excerpt: string;
  excerptSegments: PaletteExcerptSegment[];
  tags: string[];
  docType: string;
  rank: number;
}

export type PaletteExcerptSegment =
  | { kind: 'text'; value: string }
  | { kind: 'match'; value: string };

const EXCERPT_OPEN = '⦇';   // ⦇
const EXCERPT_CLOSE = '⦈';  // ⦈

function classifyKind(docType: string): PaletteSearchHit['kind'] {
  if (docType === 'observation') return 'observation';
  if (docType === 'summary') return 'summary';
  return 'memory';
}

function tokenizeExcerpt(excerpt: string): PaletteExcerptSegment[] {
  if (!excerpt) return [];
  const segments: PaletteExcerptSegment[] = [];
  let cursor = 0;
  while (cursor < excerpt.length) {
    const open = excerpt.indexOf(EXCERPT_OPEN, cursor);
    if (open === -1) {
      segments.push({ kind: 'text', value: excerpt.slice(cursor) });
      break;
    }
    if (open > cursor) {
      segments.push({ kind: 'text', value: excerpt.slice(cursor, open) });
    }
    const close = excerpt.indexOf(EXCERPT_CLOSE, open + 1);
    if (close === -1) {
      segments.push({ kind: 'text', value: excerpt.slice(open + 1) });
      break;
    }
    segments.push({ kind: 'match', value: excerpt.slice(open + 1, close) });
    cursor = close + 1;
  }
  return segments;
}

function splitTags(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

async function searchProjectMemory(
  projectId: string,
  matchQuery: string,
  perProjectLimit: number,
): Promise<PaletteSearchHit[]> {
  const rows = await runMemoryFtsStatement<MemoryFtsSnippetRow[]>(projectId, {
    method: 'all',
    sql: `
      SELECT
        rowid,
        display_content,
        doc_type,
        source,
        project_id,
        workspace_id,
        issue_id,
        entry_date,
        entry_time,
        tags,
        snippet(memory_fts, 0, '${EXCERPT_OPEN}', '${EXCERPT_CLOSE}', '…', 24) AS excerpt,
        bm25(memory_fts) AS bm25
      FROM memory_fts
      WHERE memory_fts MATCH ?
        AND project_id = ?
      ORDER BY bm25(memory_fts) ASC
      LIMIT ?
    `,
    params: [matchQuery, projectId, perProjectLimit],
  }).catch((error: unknown) => {
    // A project may not yet have a memory FTS DB — that's fine, just skip.
    console.error(`[palette] memory search failed for project ${projectId}:`, error);
    return [];
  });

  return rows.map((row) => ({
    kind: classifyKind(row.doc_type),
    id: row.source || `${row.project_id}:${row.rowid}`,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    issueId: row.issue_id,
    timestamp: row.entry_date && row.entry_time ? `${row.entry_date}T${row.entry_time}` : '',
    displayContent: row.display_content || '',
    excerpt: row.excerpt || '',
    excerptSegments: tokenizeExcerpt(row.excerpt || ''),
    tags: splitTags(row.tags || ''),
    docType: row.doc_type || '',
    rank: row.bm25,
  }));
}

// ─── Route: GET /api/palette/commands ─────────────────────────────────────────

const getPaletteCommandsRoute = HttpRouter.add(
  'GET',
  '/api/palette/commands',
  Effect.sync(() => jsonResponse({ commands: PAN_COMMANDS })),
);

// ─── Route: GET /api/palette/search?q=&limit= ─────────────────────────────────

async function runPaletteSearch(rawQuery: string, limit: number) {
  if (rawQuery.length === 0) return { memory: [], observations: [], summaries: [] };

  const matchQuery = buildMatchQuery(rawQuery);
  if (!matchQuery) return { memory: [], observations: [], summaries: [] };

  let projects: string[] = [];
  try {
    projects = listProjectsSync().map((p) => p.key);
  } catch (error) {
    console.error('[palette] failed to list projects:', error);
    return { memory: [], observations: [], summaries: [] };
  }
  if (projects.length === 0) return { memory: [], observations: [], summaries: [] };

  const perProject = Math.max(5, Math.ceil((limit * 2) / projects.length));
  const nested = await Promise.all(
    projects.map((projectId) => searchProjectMemory(projectId, matchQuery, perProject)),
  );

  const all = nested.flat().sort((a, b) => a.rank - b.rank);
  const observations: PaletteSearchHit[] = [];
  const memory: PaletteSearchHit[] = [];
  const summaries: PaletteSearchHit[] = [];
  for (const hit of all) {
    if (hit.kind === 'observation') observations.push(hit);
    else if (hit.kind === 'summary') summaries.push(hit);
    else memory.push(hit);
  }
  return {
    memory: memory.slice(0, limit),
    observations: observations.slice(0, limit),
    summaries: summaries.slice(0, limit),
  };
}

const getPaletteSearchRoute = HttpRouter.add(
  'GET',
  '/api/palette/search',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const rawQuery = (url.searchParams.get('q') ?? '').trim();
    const limitParam = url.searchParams.get('limit');
    const limit = Math.max(1, Math.min(50, limitParam ? parseInt(limitParam, 10) || 20 : 20));

    return yield* Effect.promise(async () => {
      try {
        const data = await runPaletteSearch(rawQuery, limit);
        return jsonResponse(data);
      } catch (err) {
        const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
        console.error('[palette] search failed:', msg);
        return jsonResponse({ error: 'palette search failed', detail: msg }, { status: 500 });
      }
    });
  }),
);

export const paletteRouteLayer = Layer.mergeAll(
  getPaletteCommandsRoute,
  getPaletteSearchRoute,
);

export default paletteRouteLayer;
