import { hasPastedContentWrapper, stripPastedContentWrappers } from '../../../../lib/pasted-content.js';

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

/**
 * Claude Code wraps a long composer paste in <pasted_content> (PAN-4305), so the
 * operator's own text can start with '<' or hide a real injection inside a quote.
 * Unwrap before the plain isSystemInjection() check; the stripped text itself is
 * never re-checked, since an operator paste may legitimately start with '<'.
 */
export function renderableUserText(text: string): string | null {
  const channelText = unwrapChannelMessage(text);
  if (channelText !== null) return channelText;
  if (hasPastedContentWrapper(text)) {
    const leading = text.trimStart();
    if (!leading.startsWith('<pasted_content') && isSystemInjection(leading)) return null;
    const pasted = stripPastedContentWrappers(text);
    return pasted ? pasted : null;
  }
  return isSystemInjection(text) ? null : text;
}
