import { queryTerms } from '../conversation-search/match-context.js';
import type { TitleMatchedConversation } from '../conversation-search/group-hits.js';
import { getOverdeckDatabase } from './infra.js';

const MAX_SQL_TERMS = 8;
const SQL_CANDIDATE_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/** D9: every query term must prefix at least one word of the title, words split by the same term regex. */
export function titleMatchesQuery(title: string, query: string): boolean {
  const terms = queryTerms(query);
  if (terms.length === 0) return false;
  const titleWords = queryTerms(title);
  return terms.every((term) => titleWords.some((word) => word.startsWith(term)));
}

function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

function toIso(value: number | string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

interface TitleSearchRow {
  name: string;
  title: string;
  project_key: string | null;
  cwd: string;
  archived_at: number | null;
  created_at: number;
  last_attached_at: number | null;
  claude_session_id: string | null;
}

export function searchConversationTitles(query: string, limit = DEFAULT_LIMIT): TitleMatchedConversation[] {
  const terms = queryTerms(query).slice(0, MAX_SQL_TERMS);
  if (terms.length === 0) return [];

  const likeClauses = terms.map(() => `lower(c.title) LIKE ? ESCAPE '\\'`).join(' AND ');
  const params = terms.map((term) => `%${escapeLikeTerm(term)}%`);

  const rows = getOverdeckDatabase()
    .prepare(
      `SELECT c.name, c.title, c.project_key, c.cwd, c.archived_at, c.created_at, c.last_attached_at,
        (SELECT cf.locator FROM conversation_files cf
          WHERE cf.conversation_id = c.id AND cf.harness = 'claude-code'
          ORDER BY cf.created_at ASC, cf.id ASC LIMIT 1) AS claude_session_id
       FROM conversations c
       WHERE c.title IS NOT NULL AND c.title <> ''
         AND c.name NOT LIKE 'agent-%' AND c.name NOT LIKE 'planning-%' AND c.name NOT LIKE 'specialist-%'
         AND ${likeClauses}
       ORDER BY COALESCE(c.last_attached_at, c.created_at) DESC
       LIMIT ${SQL_CANDIDATE_LIMIT}`,
    )
    .all(...params) as TitleSearchRow[];

  const matches: TitleMatchedConversation[] = [];
  for (const row of rows) {
    if (!titleMatchesQuery(row.title, query)) continue;
    matches.push({
      conversationId: row.name,
      projectKey: row.project_key,
      title: row.title,
      archived: row.archived_at != null,
      sessionId: row.claude_session_id,
      cwd: row.cwd,
      lastActivityAt: toIso(row.last_attached_at ?? row.created_at),
    });
    if (matches.length >= limit) break;
  }
  return matches;
}
