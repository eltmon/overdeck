/**
 * PAN-5000: a linked conversation row with no title, or whose title is only
 * an attachment file path, falls back to this label instead of leaking the
 * owner's list name or a filesystem path into the UI.
 */
export const UNTITLED_CONVERSATION_TITLE = 'New conversation';

/** A leading absolute path with at least two separators (`/a/b…`, `~/a/b…`, `C:\a\b…`). */
const LEADING_PATH = /^@?(?:~|[A-Za-z]:)?[\\/][^\s\\/]+[\\/]/;

/** The title a linked conversation row shows: `title` trimmed, or {@link UNTITLED_CONVERSATION_TITLE} when it is blank or a file path. */
export function linkedRowTitle(title: string | null | undefined): string {
  const trimmed = title?.trim();
  if (!trimmed || LEADING_PATH.test(trimmed)) return UNTITLED_CONVERSATION_TITLE;
  return trimmed;
}
