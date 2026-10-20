/**
 * Store-derived lookup maps for the Command Deck root (PAN-4560).
 *
 * `CommandDeck` needs an issue's title, creation date and agent id, not the
 * whole issue or agent lists. Each builder returns a flat `Record<string,
 * string>`, so a `useShallow` selector keeps its previous value and does not
 * re-render the deck while the entries it reads are unchanged. Results are
 * cached per slice identity, so an unrelated store set costs one WeakMap read.
 */
import type { Issue } from '../../types';

type StringMap = Record<string, string>;

function cachedBy<T extends object>(build: (source: T) => StringMap): (source: T) => StringMap {
  const cache = new WeakMap<T, StringMap>();
  return (source) => {
    let map = cache.get(source);
    if (!map) {
      map = build(source);
      cache.set(source, map);
    }
    return map;
  };
}

/** Lowercased issue id → agent id, preferring the `agent-` prefixed work agent. */
export const agentIdsByIssueKey = cachedBy((agentsById: Record<string, { id: string; issueId?: string }>) => {
  const map: StringMap = {};
  for (const agent of Object.values(agentsById)) {
    const key = agent.issueId?.toLowerCase();
    if (!key) continue;
    if (!map[key] || (agent.id.startsWith('agent-') && !map[key].startsWith('agent-'))) map[key] = agent.id;
  }
  return map;
});

/** Issue identifier (as written and lowercased) → title. */
export const issueTitlesByKey = cachedBy((issues: Issue[]) => {
  const map: StringMap = {};
  for (const issue of issues) {
    if (!issue.identifier) continue;
    map[issue.identifier.toLowerCase()] = issue.title;
    map[issue.identifier] = issue.title;
  }
  return map;
});

/** Issue identifier → creation date of the first issue with that identifier. */
export const issueCreatedAtById = cachedBy((issues: Issue[]) => {
  const map: StringMap = {};
  for (const issue of issues) {
    if (!issue.identifier || issue.identifier in map || issue.createdAt === undefined) continue;
    map[issue.identifier] = issue.createdAt;
  }
  return map;
});
