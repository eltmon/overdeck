/**
 * Returns true for Claude Code internal injections that should not appear as user messages:
 *   - XML-tagged system context (<system-reminder>, <command-name>, etc.)
 *   - Skill file content injections ("Base directory for this skill: ...")
 *   - Compaction summary injections ("This session is being continued...")
 *   - Memory/hook injections ("Human:" prefix blocks, etc.)
 */
export function isSystemInjection(text: string): boolean {
  if (text.startsWith('<')) return true;
  if (text.startsWith('Base directory for this skill:')) return true;
  if (text.startsWith('This session is being continued from a previous conversation')) return true;
  if (text.startsWith('Human:') && text.includes('\n\nAssistant:')) return true;
  return false;
}

export function unwrapChannelMessage(text: string): string | null {
  const match = text.match(/^<channel\b[^>]*>\n?([\s\S]*?)\n?<\/channel>$/);
  return match ? match[1] : null;
}

export function renderableUserText(text: string): string | null {
  const channelText = unwrapChannelMessage(text);
  if (channelText !== null) return channelText;
  return isSystemInjection(text) ? null : text;
}
