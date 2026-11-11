/**
 * PAN-4264: per-repo notes about the GitHub App, in
 * `~/.overdeck/github-quota/repo-notes.json`.
 *
 * A 404 from an App REST issue listing means the App is not installed on that
 * repo (krux). The repo is marked `appInstalled: false` for 6 hours, so
 * membership refreshes stop spending four failed App calls per refresh and
 * list its issues through the gh user token instead. The first 404 per repo
 * per TTL logs one warning; `pan doctor github-quota` lists the repo.
 */

import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getGitHubQuotaDir } from './ledger.js';

export const APP_NOT_INSTALLED_TTL_MS = 6 * 60 * 60_000;

export interface AppMissingRepo {
  repo: string;
  /** ISO time the 404 was seen. */
  checkedAt: string;
  /** ISO time the App path is tried again. */
  expiresAt: string;
}

interface RepoNote {
  appInstalled: false;
  checkedAt: string;
  expiresAt: string;
}

let notes: Map<string, RepoNote> | null = null;
let notesDir: string | null = null;

function repoNotesFile(): string {
  return join(getGitHubQuotaDir(), 'repo-notes.json');
}

/** The in-memory notes, loaded once from disk (per quota directory). */
function loadNotes(): Map<string, RepoNote> {
  const dir = getGitHubQuotaDir();
  if (notes && notesDir === dir) return notes;
  notes = new Map();
  notesDir = dir;
  try {
    const parsed = JSON.parse(readFileSync(repoNotesFile(), 'utf8')) as { repos?: Record<string, RepoNote> };
    for (const [repo, note] of Object.entries(parsed.repos ?? {})) {
      if (note && note.appInstalled === false && typeof note.expiresAt === 'string') notes.set(repo, note);
    }
  } catch {
    // No notes yet.
  }
  return notes;
}

function repoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`.toLowerCase();
}

/** True while `owner/repo` is marked as having no App installation. */
export function isAppMarkedNotInstalled(owner: string, repo: string, nowMs: number = Date.now()): boolean {
  const note = loadNotes().get(repoKey(owner, repo));
  return note !== undefined && Date.parse(note.expiresAt) > nowMs;
}

/** Mark `owner/repo` as having no App installation for the TTL. Never throws. */
export function markAppNotInstalled(owner: string, repo: string, nowMs: number = Date.now()): void {
  try {
    const key = repoKey(owner, repo);
    const map = loadNotes();
    const current = map.get(key);
    if (current && Date.parse(current.expiresAt) > nowMs) return;
    map.set(key, {
      appInstalled: false,
      checkedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + APP_NOT_INSTALLED_TTL_MS).toISOString(),
    });
    console.warn(`[github-app] GitHub App is not installed on ${owner}/${repo}; Overdeck acts as the gh user there`);
    persistNotes(map);
  } catch {
    // NFR-2: bookkeeping never fails the refresh.
  }
}

/**
 * PAN-5153: forget the "not installed" note for `owner/repo`, so the next
 * installation lookup asks GitHub again. Never throws.
 */
export function clearAppNotInstalled(owner: string, repo: string): void {
  try {
    const map = loadNotes();
    if (!map.delete(repoKey(owner, repo))) return;
    persistNotes(map);
  } catch {
    // Bookkeeping never fails the caller.
  }
}

let persistSeq = 0;

/** Write the notes to disk in the background (atomic rename). Never throws. */
function persistNotes(map: Map<string, RepoNote>): void {
  const file = repoNotesFile();
  const body = `${JSON.stringify({ repos: Object.fromEntries(map) }, null, 2)}\n`;
  void (async () => {
    await mkdir(getGitHubQuotaDir(), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.${persistSeq++}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, file);
  })().catch(() => undefined);
}

/** Repos currently marked as missing the App, read from disk (for doctor). */
export function readAppMissingRepos(nowMs: number = Date.now()): AppMissingRepo[] {
  try {
    const parsed = JSON.parse(readFileSync(repoNotesFile(), 'utf8')) as { repos?: Record<string, RepoNote> };
    return Object.entries(parsed.repos ?? {})
      .filter(([, note]) => note?.appInstalled === false && Date.parse(note.expiresAt) > nowMs)
      .map(([repo, note]) => ({ repo, checkedAt: note.checkedAt, expiresAt: note.expiresAt }));
  } catch {
    return [];
  }
}

/** Forget the in-memory notes (tests only). */
export function resetRepoNotesForTests(): void {
  notes = null;
  notesDir = null;
}
