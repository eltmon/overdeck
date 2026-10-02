/**
 * PAN-4451: the refs an agent names with `pan task block --on` — the issues
 * and PRs an item waits on. Parsed and validated at declaration time, stored
 * in the `blocked.declared` journal entry as canonical strings, and read back
 * by the blocker-wake tick.
 *
 * A leaf module: `pan task` imports it, so it must not import messaging, the
 * dashboard, or agent state.
 */
import { parseArtifactRef } from '../forge.js';

export type BlockerRef =
  | { kind: 'issue'; id: string } // 'PAN-4307'
  | { kind: 'pr'; repo: string; number: number }; // repo = 'eltmon/overdeck'

export class BlockerRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockerRefError';
  }
}

export interface BlockerRefContext {
  blockedIssueId: string;
  /** True when the issue ID belongs to a registered project. */
  isKnownIssue: (issueId: string) => boolean;
  /** The blocked issue's GitHub repo as 'owner/repo', or null when it is not on GitHub. */
  blockedIssueRepo: () => string | null;
}

const ISSUE_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const SHORT_PR_RE = /^#(\d+)$/;
const REPO_PR_RE = /^([\w.-]+\/[\w.-]+)#(\d+)$/;
const GITHUB_PR_URL_RE = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:$|[/?#])/i;

/** Canonical string: 'PAN-4307' or 'eltmon/overdeck#4444'. */
export function formatBlockerRef(ref: BlockerRef): string {
  return ref.kind === 'issue' ? ref.id : `${ref.repo}#${ref.number}`;
}

/** Inverse of formatBlockerRef, for journal data; null for anything else. */
export function parseStoredBlockerRef(value: string): BlockerRef | null {
  if (ISSUE_RE.test(value)) return { kind: 'issue', id: value.toUpperCase() };
  const pr = value.match(REPO_PR_RE);
  if (pr) return { kind: 'pr', repo: pr[1], number: Number.parseInt(pr[2], 10) };
  return null;
}

function parseOne(value: string, ctx: BlockerRefContext): BlockerRef {
  if (ISSUE_RE.test(value)) {
    const id = value.toUpperCase();
    if (id === ctx.blockedIssueId.toUpperCase()) {
      throw new BlockerRefError(`${id} cannot be blocked on itself`);
    }
    if (!ctx.isKnownIssue(id)) {
      throw new BlockerRefError(`${value} is not an issue of a registered project`);
    }
    return { kind: 'issue', id };
  }
  const short = value.match(SHORT_PR_RE);
  if (short) {
    const repo = ctx.blockedIssueRepo();
    if (!repo) {
      throw new BlockerRefError(`${value} needs the blocked issue to be on GitHub; use a full PR URL`);
    }
    return { kind: 'pr', repo, number: Number.parseInt(short[1], 10) };
  }
  const repoPr = value.match(REPO_PR_RE);
  if (repoPr) return { kind: 'pr', repo: repoPr[1], number: Number.parseInt(repoPr[2], 10) };
  if (/^https?:\/\//i.test(value)) {
    const artifact = parseArtifactRef(value);
    if (artifact?.forge === 'gitlab') {
      throw new BlockerRefError(`${value}: GitLab merge requests are not supported; name the issue ID instead`);
    }
    const url = value.match(GITHUB_PR_URL_RE);
    if (artifact?.forge === 'github' && url) {
      return { kind: 'pr', repo: `${url[1]}/${url[2]}`, number: artifact.number };
    }
  }
  throw new BlockerRefError(`${value} is not an issue ID, #N, owner/repo#N, or a GitHub PR URL`);
}

/**
 * Parse CLI values. Each value may hold comma-separated refs. Returns
 * de-duplicated refs in input order. Throws BlockerRefError naming the first
 * bad ref.
 */
export function parseBlockerRefs(values: readonly string[], ctx: BlockerRefContext): BlockerRef[] {
  const refs: BlockerRef[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const piece of value.split(',')) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      const ref = parseOne(trimmed, ctx);
      const key = formatBlockerRef(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }
  }
  if (refs.length === 0) throw new BlockerRefError('--on needs at least one issue or PR');
  return refs;
}
