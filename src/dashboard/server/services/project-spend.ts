/**
 * Which cost events belong to a project's spend (PAN-5288 WI-8, A-D17).
 *
 * `GET /api/costs/summary?project=<PREFIX>` used to count only events whose
 * issue id starts with `<PREFIX>-`. Conversation cost events carry
 * `issueId: 'UNKNOWN'` and the conversation's session name as `agentId`
 * (PAN-5284 D-16), so they were never counted. An event now counts when its
 * issue id has the prefix or its agent id is the session of one of the
 * project's conversations.
 */

function underPath(cwd: string, root: string): boolean {
  const base = root.replace(/\/+$/, '');
  return cwd === base || cwd.startsWith(`${base}/`);
}

/** Registered project keys whose `issue_prefix` or any `issue_prefixes` entry is `prefix` (case-insensitive). */
export function projectKeysForPrefix(
  prefix: string,
  projects: Array<{ key: string; config: { issue_prefix?: string; issue_prefixes?: string[] } }>,
): Set<string> {
  const wanted = prefix.toUpperCase();
  const keys = new Set<string>();
  for (const { key, config } of projects) {
    const prefixes = [config.issue_prefix, ...(config.issue_prefixes ?? [])];
    if (prefixes.some((p) => typeof p === 'string' && p.toUpperCase() === wanted)) keys.add(key);
  }
  return keys;
}

/**
 * Session names of the conversations in the projects `keys`: an explicit
 * `projectKey`, or no `projectKey` and a cwd whose longest containing
 * registered project path is one of them.
 */
export function conversationSessionsForProject(
  keys: ReadonlySet<string>,
  projects: Array<{ key: string; config: { path: string } }>,
  conversations: ReadonlyArray<{ tmuxSession: string; projectKey: string | null; cwd: string }>,
): Set<string> {
  const byLength = [...projects].sort((a, b) => b.config.path.length - a.config.path.length);
  const sessions = new Set<string>();
  for (const conv of conversations) {
    const key = conv.projectKey ?? byLength.find((p) => underPath(conv.cwd, p.config.path))?.key ?? null;
    if (key !== null && keys.has(key)) sessions.add(conv.tmuxSession);
  }
  return sessions;
}

/** True when the event is the project's spend: its issue id has the prefix, or its agent is a member session. */
export function inProjectSpend(entry: { issueId?: string; agentId?: string }, prefix: string, sessions: ReadonlySet<string>): boolean {
  if (typeof entry.issueId === 'string' && entry.issueId.toUpperCase().startsWith(`${prefix.toUpperCase()}-`)) return true;
  return typeof entry.agentId === 'string' && sessions.has(entry.agentId);
}
