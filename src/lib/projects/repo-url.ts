/**
 * Pure repository URL parser (PAN-3836 WI-1).
 *
 * Parses GitHub/GitLab URLs in multiple formats (shorthand, SCP-like, https)
 * and normalizes them to extract provider, clone URL, and folder name.
 * No network calls, no filesystem operations.
 */

export interface ParsedRepoUrl {
  /** e.g. 'github' | 'gitlab' | null for unknown hosts */
  provider: 'github' | 'gitlab' | null;
  /** The organization/path, e.g. 'o/r' or 'g/sub/r'. null if unparseable. */
  slug: string | null;
  /** Last segment of slug, e.g. 'r' from 'o/r'. null if unparseable. */
  folderName: string | null;
  /** Normalized clone URL, with .git appended for github/gitlab https URLs. */
  cloneUrl: string | null;
}

/**
 * Parse a repository URL in multiple formats:
 *   - Shorthand: 'o/r' → github.com/o/r.git
 *   - SCP-like: 'git@host:path/repo.git' or 'git@host:path/repo'
 *   - HTTPS: 'https://host/path/repo' or 'https://host/path/repo.git'
 *   - SSH: 'ssh://git@host/path/repo.git'
 *
 * Returns null values for unparseable input. A bare word like 'orca' returns
 * all nulls. An unknown host like 'https://example.com/x/y.git' returns
 * cloneUrl preserved but provider and slug null.
 */
export function parseRepoUrl(raw: string): ParsedRepoUrl {
  const trimmed = raw.trim();

  // Empty or bare word (no /, @, :, or ://)
  if (!trimmed || !/[/:@]/.test(trimmed)) {
    return {
      provider: null,
      slug: null,
      folderName: null,
      cloneUrl: null,
    };
  }

  // Try shorthand format first: 'o/r' or 'o/r.git'
  const shorthandMatch = trimmed.match(/^([^/:@]+)\/([^/:@.]+)(\.git)?$/);
  if (shorthandMatch) {
    const org = shorthandMatch[1];
    const repo = shorthandMatch[2];
    return {
      provider: 'github',
      slug: `${org}/${repo}`,
      folderName: repo,
      cloneUrl: `https://github.com/${org}/${repo}.git`,
    };
  }

  // Try SCP-like format: 'git@host:path/repo.git' or 'ssh://git@host/path/repo.git'
  const scpMatch = trimmed.match(/^(?:ssh:\/\/)?git@([^/:]+)[:\/](.+?)(?:\.git)?$/);
  if (scpMatch) {
    const host = scpMatch[1];
    const path = scpMatch[2];
    const provider = getProvider(host);

    // Normalize path: remove trailing .git and slashes
    const cleanPath = path.replace(/\/+$/, '').replace(/\.git$/, '');
    const segments = cleanPath.split('/');
    const folderName = segments[segments.length - 1] || null;

    // Build clone URL: append .git for known providers
    let cloneUrl: string;
    if (provider === 'github' || provider === 'gitlab') {
      cloneUrl = `https://${host}/${cleanPath}.git`;
    } else {
      cloneUrl = `ssh://git@${host}/${cleanPath}`;
    }

    return {
      provider,
      slug: provider ? (cleanPath || null) : null,
      folderName: provider ? folderName : null,
      cloneUrl,
    };
  }

  // Try HTTPS format: 'https://host/path/repo' or 'https://host/path/repo.git'
  const httpsMatch = trimmed.match(/^https:\/\/([^/:]+)\/(.+?)(?:\.git)?\/?\s*$/);
  if (httpsMatch) {
    const host = httpsMatch[1];
    const path = httpsMatch[2];
    const provider = getProvider(host);

    // Normalize path: remove trailing .git and slashes
    const cleanPath = path.replace(/\/+$/, '').replace(/\.git$/, '');
    const segments = cleanPath.split('/');
    const folderName = segments[segments.length - 1] || null;

    // Build clone URL: always append .git for HTTPS
    const cloneUrl = `https://${host}/${cleanPath}.git`;

    return {
      provider,
      slug: provider ? (cleanPath || null) : null,
      folderName: provider ? folderName : null,
      cloneUrl,
    };
  }

  // Unparseable format
  return {
    provider: null,
    slug: null,
    folderName: null,
    cloneUrl: null,
  };
}

/** Detect provider by host name. */
function getProvider(host: string): 'github' | 'gitlab' | null {
  if (host === 'github.com') return 'github';
  if (host === 'gitlab.com') return 'gitlab';
  return null;
}
