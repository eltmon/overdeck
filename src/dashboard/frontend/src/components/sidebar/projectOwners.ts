/**
 * PAN-5153: group the sidebar's projects by owner, with each owner's collapsed
 * state kept per browser. PAN-5161: the owner is projects.yaml `owner`, else
 * the GitHub owner from `github_repo`, else the GitLab group from `gitlab_repo`.
 * Display only: it never changes which identity acts on a repository.
 */
import { useCallback, useState } from 'react';

export const COLLAPSED_OWNERS_KEY = 'overdeck.sidebar.collapsedOwners';

/** The collapse key of the group without an owner (no GitHub owner is empty). */
export const OTHER_OWNER_KEY = '';

/** "owner/repo" → "owner"; anything else → null. */
export function githubOwnerOf(repo: string | null | undefined): string | null {
  const match = /^([^/\s]+)\/[^/\s]+$/.exec((repo ?? '').trim());
  return match ? match[1]! : null;
}

/** "group/repo" or "group/sub/repo" → "group"; anything else → null. */
export function gitlabGroupOf(repo: string | null | undefined): string | null {
  const match = /^([^/\s]+)(?:\/[^/\s]+)+$/.exec((repo ?? '').trim());
  return match ? match[1]! : null;
}

export interface OwnedProject {
  owner?: string | null;
  githubRepo?: string | null;
  gitlabRepo?: string | null;
}

/** PAN-5161: the explicit owner, then the GitHub owner, then the GitLab group; null when none is set. */
export function projectOwnerOf(project: OwnedProject): string | null {
  return project.owner?.trim() || githubOwnerOf(project.githubRepo) || gitlabGroupOf(project.gitlabRepo);
}

export interface ProjectOwnerGroup<T> {
  owner: string | null;
  projects: T[];
}

/**
 * Owners compare case-insensitively and show the first spelling seen. Groups
 * sort by owner with the no-owner group last; projects keep their input
 * order. Fewer than two owners give one group with owner null.
 */
export function groupProjectsByOwner<T extends OwnedProject>(projects: T[]): ProjectOwnerGroup<T>[] {
  const groups = new Map<string, ProjectOwnerGroup<T>>();
  const other: T[] = [];
  for (const project of projects) {
    const owner = projectOwnerOf(project);
    if (!owner) {
      other.push(project);
      continue;
    }
    const key = owner.toLowerCase();
    const group = groups.get(key) ?? { owner, projects: [] };
    group.projects.push(project);
    groups.set(key, group);
  }
  if (groups.size < 2) return [{ owner: null, projects }];
  const sorted = [...groups.values()].sort((a, b) => a.owner!.localeCompare(b.owner!));
  return other.length > 0 ? [...sorted, { owner: null, projects: other }] : sorted;
}

/** The collapsed owners stored in this browser; [] on any error. */
export function readCollapsedOwners(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSED_OWNERS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Store the collapsed owners. Never throws. */
export function writeCollapsedOwners(owners: string[]): void {
  try {
    localStorage.setItem(COLLAPSED_OWNERS_KEY, JSON.stringify(owners));
  } catch {
    // Storage unavailable: the collapse lasts for this page only.
  }
}

/** The collapsed owner keys and a toggle that persists them. */
export function useCollapsedOwners(): [string[], (owner: string | null) => void] {
  const [collapsedOwners, setCollapsedOwners] = useState(readCollapsedOwners);
  const toggleOwner = useCallback((owner: string | null) => {
    setCollapsedOwners((current) => {
      const key = owner ?? OTHER_OWNER_KEY;
      const next = current.includes(key) ? current.filter((o) => o !== key) : [...current, key];
      writeCollapsedOwners(next);
      return next;
    });
  }, []);
  return [collapsedOwners, toggleOwner];
}
