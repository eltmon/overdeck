/**
 * Known skill packs not yet added (PAN-5540): the frontend mirror of
 * `src/lib/skill-packs/known.ts`, the query that reads
 * `GET /api/skills/packs/available`, and the preview/add requests the add
 * dialog sends. The Skills page and the new-conversation skills field share
 * the query key, so an add refreshes both.
 */
import { useQuery } from '@tanstack/react-query';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';

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

/** The preview a pack add shows before the trust step (mirror of `PackPreviewDto` in known.ts). */
export interface PackPreviewDto {
  id: string;
  url: string;
  ref: string;
  commit: string;
  adapter: string;
  pluginRoot: string | null;
  license: string | null;
  skills: Array<{ name: string; description: string; optIn: boolean }>;
  excluded: Array<{ name: string; reason: string }>;
  notApplied: string[];
  executables: string[];
  mcpServers: Array<{ name: string; url: string }>;
  disclosure: string | null;
}

/** Query keys an add invalidates: the Skills page, this listing, and the new-conversation skills field. */
export const PACK_ADD_INVALIDATES = [['skill-overrides'], AVAILABLE_PACKS_QUERY_KEY, ['new-conversation-skills']] as const;

export interface PackRequestResult<T> {
  ok: boolean;
  status: number;
  /** The route's error code (`exists`, `commit-changed`, `busy`, …) when not ok. */
  code: string | null;
  error: string | null;
  body: T | null;
}

async function postPackRequest<T>(path: string, payload: unknown): Promise<PackRequestResult<T>> {
  const res = await fetch(path, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(path),
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: unknown; code?: unknown }) | null;
  if (res.ok) return { ok: true, status: res.status, code: null, error: null, body };
  return {
    ok: false,
    status: res.status,
    code: typeof body?.code === 'string' ? body.code : null,
    error: typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`,
    body: null,
  };
}

/** Fetch and extract a known pack and return its preview; registers nothing. */
export function previewPack(id: string): Promise<PackRequestResult<{ preview: PackPreviewDto }>> {
  return postPackRequest('/api/skills/packs/preview', { id });
}

/** Register a known pack when its ref still resolves to the previewed commit. */
export function addPack(id: string, commit: string): Promise<PackRequestResult<{ added: true; preview: PackPreviewDto }>> {
  return postPackRequest('/api/skills/packs', { id, commit });
}
