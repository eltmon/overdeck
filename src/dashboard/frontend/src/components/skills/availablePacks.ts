/**
 * Known skill packs not yet added (PAN-5540): the frontend mirror of
 * `src/lib/skill-packs/known.ts` and the query that reads
 * `GET /api/skills/packs/available`. The Skills page and the new-conversation
 * skills field share the query key, so an add refreshes both.
 */
import { useQuery } from '@tanstack/react-query';

export type NotAddableReason = 'needs-ref' | 'runs-build';

export interface AvailablePack {
  id: string;
  url: string | null;
  ref: string | null;
  adapter: string | null;
  disclosure: string | null;
  added: boolean;
  dashboardAddable: boolean;
  reason: NotAddableReason | null;
  addCommand: string;
  groups: string[];
}

export interface AvailableGroup {
  name: string;
  packs: string[];
  source: 'built-in' | 'config';
  missing: string[];
  unknown: string[];
  dashboardAddable: boolean;
  addCommand: string;
}

export interface AvailablePackListing {
  packs: AvailablePack[];
  groups: AvailableGroup[];
}

export const AVAILABLE_PACKS_QUERY_KEY = ['skill-packs-available'] as const;

export async function fetchAvailablePacks(): Promise<AvailablePackListing> {
  const res = await fetch('/api/skills/packs/available');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as Partial<AvailablePackListing> | null;
  // Tolerate any body (tests stub fetch globally): missing arrays mean nothing to show.
  return {
    packs: Array.isArray(body?.packs) ? body.packs : [],
    groups: Array.isArray(body?.groups) ? body.groups : [],
  };
}

export function useAvailablePacks() {
  return useQuery({ queryKey: AVAILABLE_PACKS_QUERY_KEY, queryFn: fetchAvailablePacks, retry: false, staleTime: 60_000 });
}

/** `4 packs not added` when every member is missing, else `2 of 4 packs not added`. */
export function missingLabel(group: AvailableGroup): string {
  const n = group.missing.length;
  if (n < group.packs.length) return `${n} of ${group.packs.length} packs not added`;
  return `${n} ${n === 1 ? 'pack' : 'packs'} not added`;
}

/** D-6: the sentence for group members that are not known packs. */
export function unknownMembersNote(unknown: readonly string[]): string {
  const ids = unknown.join(', ');
  return `${ids} ${unknown.length === 1 ? 'is not a known pack' : 'are not known packs'}; add ${unknown.length === 1 ? 'it' : 'each'} with pan skills pack add <id> <url> --ref <ref>`;
}
