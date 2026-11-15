/**
 * modelLabels — short display labels for model ids, shared by conversation
 * rows and issue rows (PAN-5293). A leaf module: it imports nothing, so the
 * issue tree can use it without an import cycle through ConversationList.
 */

/** Trim model IDs to a readable label, e.g. "claude-opus-4-8" → "opus-4-8". */
export function shortModel(model: string): string {
  return model
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '');
}
