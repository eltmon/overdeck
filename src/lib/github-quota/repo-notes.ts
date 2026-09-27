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
    console.warn(`[pipeline-membership] GitHub App is not installed on ${owner}/${repo}; using the gh user token for issue listings`);
    const file = repoNotesFile();
    const body = `${JSON.stringify({ repos: Object.fromEntries(map) }, null, 2)}\n`;
    void (async () => {
      await mkdir(getGitHubQuotaDir(), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, body);
      await rename(tmp, file);
    })().catch(() => undefined);
  } catch {
    // NFR-2: bookkeeping never fails the refresh.
  }
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
