import type { ConversationSearchHit } from './ranker.js';
import { classifyChunkMatch } from './match-context.js';

export type ConversationMatchTier = 'title' | 'text' | 'path';

export interface ConversationIdentity {
  conversationId: string;
  projectKey: string | null;
  title: string | null;
  archived: boolean;
}

export interface TitleMatchedConversation extends ConversationIdentity {
  title: string;
  /** Claude session locator for opening; null when the row has no claude-code file. */
  sessionId: string | null;
  cwd: string;
  lastActivityAt: string | null;
}

export interface GroupedConversationHit {
  identity: ConversationIdentity;
  tier: ConversationMatchTier;
  hitCount: number;
  bestHit: ConversationSearchHit | null;
  titleMatch: TitleMatchedConversation | null;
  score: number;
  lastActivityAt: string | null;
}

interface GroupState {
  identity: ConversationIdentity;
  hitCount: number;
  firstAny: ConversationSearchHit | null;
  firstText: ConversationSearchHit | null;
  titleMatch: TitleMatchedConversation | null;
}

const TIER_ORDER: Record<ConversationMatchTier, number> = { title: 0, text: 1, path: 2 };

function compareGroups(a: GroupedConversationHit, b: GroupedConversationHit): number {
  const tierDiff = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
  if (tierDiff !== 0) return tierDiff;
  if (b.score !== a.score) return b.score - a.score;
  if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount;
  const aTime = a.lastActivityAt ?? '';
  const bTime = b.lastActivityAt ?? '';
  if (aTime !== bTime) return aTime < bTime ? 1 : -1;
  const aId = a.identity.conversationId;
  const bId = b.identity.conversationId;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

export function groupConversationHits(input: {
  hits: ConversationSearchHit[];
  titleMatches: TitleMatchedConversation[];
  query: string;
  resolve: (rootSessionId: string) => ConversationIdentity;
  limit: number;
}): GroupedConversationHit[] {
  const { hits, titleMatches, query, resolve, limit } = input;
  const groups = new Map<string, GroupState>();

  for (const hit of hits) {
    const root = hit.parentSessionId ?? hit.sessionId;
    const identity = resolve(root);
    const key = identity.conversationId;
    let group = groups.get(key);
    if (!group) {
      group = { identity, hitCount: 0, firstAny: null, firstText: null, titleMatch: null };
      groups.set(key, group);
    }
    group.hitCount += 1;
    if (!group.firstAny) group.firstAny = hit;
    if (!group.firstText && classifyChunkMatch(hit.text, query) === 'text') {
      group.firstText = hit;
    }
  }

  for (const titleMatch of titleMatches) {
    const key = titleMatch.conversationId;
    let group = groups.get(key);
    if (!group) {
      group = {
        identity: {
          conversationId: titleMatch.conversationId,
          projectKey: titleMatch.projectKey,
          title: titleMatch.title,
          archived: titleMatch.archived,
        },
        hitCount: 0,
        firstAny: null,
        firstText: null,
        titleMatch: null,
      };
      groups.set(key, group);
    } else {
      group.identity = { ...group.identity, title: titleMatch.title, archived: titleMatch.archived };
    }
    group.titleMatch = titleMatch;
  }

  const rows: GroupedConversationHit[] = [];
  for (const group of groups.values()) {
    const bestHit = group.firstText ?? group.firstAny ?? null;
    const tier: ConversationMatchTier = group.titleMatch ? 'title' : group.firstText ? 'text' : 'path';
    rows.push({
      identity: group.identity,
      tier,
      hitCount: group.hitCount,
      bestHit,
      titleMatch: group.titleMatch,
      score: bestHit?.rrfScore ?? 0,
      lastActivityAt: bestHit?.ts ?? group.titleMatch?.lastActivityAt ?? null,
    });
  }

  rows.sort(compareGroups);
  return rows.slice(0, limit);
}
