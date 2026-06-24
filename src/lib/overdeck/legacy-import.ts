import { existsSync } from 'node:fs';
import { openDatabase } from '../database/driver.js';
import { getConversationByName, isAgentConversationName } from './conversations.js';

export interface PreviewRow {
  name: string;
  title: string | null;
  createdAt: string;
  model: string | null;
  lastActivityAt: string | null;
  messageCount: number | null;
  hasFavorite: boolean;
  claudeSessionId: string | null;
  alreadyImported: boolean;
}

export interface PreviewResult {
  found: true;
  rows: PreviewRow[];
}

export interface PreviewNotFound {
  found: false;
}

export function previewLegacyConversations(path: string): PreviewResult | PreviewNotFound {
  if (!existsSync(path)) {
    return { found: false };
  }

  const db = openDatabase(path, { readOnly: true });
  try {
    const legacyRows = db
      .prepare<{
        name: string;
        title: string | null;
        created_at: string;
        model: string | null;
        last_attached_at: string | null;
        claude_session_id: string | null;
      }>(
        `SELECT name, title, created_at, model, last_attached_at, claude_session_id
         FROM conversations
         ORDER BY created_at DESC`,
      )
      .all();

    const favSet = new Set<string>(
      (
        db
          .prepare<{ item_id: string }>(
            `SELECT item_id FROM favorites WHERE type = 'conversation'`,
          )
          .all() as { item_id: string }[]
      ).map((r) => r.item_id),
    );

    const rows: PreviewRow[] = [];
    for (const row of legacyRows as {
      name: string;
      title: string | null;
      created_at: string;
      model: string | null;
      last_attached_at: string | null;
      claude_session_id: string | null;
    }[]) {
      if (isAgentConversationName(row.name)) continue;
      rows.push({
        name: row.name,
        title: row.title,
        createdAt: row.created_at,
        model: row.model,
        lastActivityAt: row.last_attached_at,
        messageCount: null,
        hasFavorite: favSet.has(row.name),
        claudeSessionId: row.claude_session_id,
        alreadyImported: getConversationByName(row.name) !== null,
      });
    }

    return { found: true, rows };
  } finally {
    db.close();
  }
}
