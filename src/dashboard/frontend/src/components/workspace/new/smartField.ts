/**
 * Classifies what was typed into the New Workspace name field (PAN-4281 D12,
 * D22). First match wins: an issue reference, then a URL, else plain text.
 * Classification only — the field turns an issue into "open it and start
 * work", a branch match into the parent branch, and text into a name.
 */

export type SmartInput = { kind: 'issue'; id: string } | { kind: 'url'; id?: string; url: string } | { kind: 'text' };

const GITHUB_ISSUE_URL = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/(\d+)/;

/** `prefixes` are the registered issue prefixes, e.g. `['PAN', 'MIN']`. */
export function classifySmartInput(text: string, prefixes: string[]): SmartInput {
  const value = text.trim();

  const hash = /^#(\d+)$/.exec(value);
  if (hash) return { kind: 'issue', id: `#${hash[1]}` };

  const prefixed = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(value);
  if (prefixed) {
    const prefix = prefixed[1]!.toUpperCase();
    if (prefixes.some((known) => known.toUpperCase() === prefix)) {
      return { kind: 'issue', id: `${prefix}-${prefixed[2]}` };
    }
  }

  const github = GITHUB_ISSUE_URL.exec(value);
  if (github) return { kind: 'url', id: `#${github[2]}`, url: value };
  if (/^https?:\/\//.test(value)) return { kind: 'url', url: value };

  return { kind: 'text' };
}

/** A workspace name the core accepts (letters, numbers, hyphens) from free text. */
export function toWorkspaceSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
