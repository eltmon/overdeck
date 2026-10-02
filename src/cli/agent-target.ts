/**
 * Shared agent-target resolution for pan tell/pause/unpause/untroubled/kill
 * (PAN-4465). Accepts issue IDs, qualified agent IDs, bare numerics, and
 * conversation forms (`conv/<n>`, `conv:<n>`, a dashboard `/conv/<n>` URL).
 *
 * Deliberately outside src/lib/agents/identity.ts: that module is an import-
 * cycle leaf, and conversations.ts pulls in dashboard/server/event-store.js.
 */
import chalk from 'chalk';
import { isQualifiedAgentId, resolveAgentTarget } from '../lib/agents.js';
import { listBareNumericIssueMatches, resolveIssueId } from '../lib/issue-id.js';

export interface AgentTargetCandidate {
  /** What the operator would type to pick this one: `PAN-2972` or `conv/2972`. */
  explicitForm: string;
  /** One-line description: `issue PAN-2972` or `conversation 2972 "Fernkite deploy" (conv-20260928-7563)`. */
  label: string;
}

export type AgentTargetResolution =
  | { kind: 'agent'; agentId: string; via: 'agent-id' | 'conversation' }
  | { kind: 'issue'; issueId: string }
  | { kind: 'ambiguous'; input: string; candidates: AgentTargetCandidate[] }
  | { kind: 'unresolved'; input: string; reason: string };

export type AgentTargetFailure = Exclude<AgentTargetResolution, { kind: 'agent' } | { kind: 'issue' }>;

export const ACCEPTED_TARGET_FORMS: readonly string[] = [
  'issue ID       PAN-1148 (a bare 1148 works when it is unambiguous)',
  'agent ID       agent-pan-1148, strike-pan-1723, conv-20260928-7563',
  'conversation   conv/2972, conv:2972, or a dashboard URL such as https://overdeck.localhost/conv/2972',
  'bare number    an issue agent if one exists, else that conversation; both → this list',
];

const CONV_URL = /^https?:\/\/[^/]+\/conv\/([^/?#]+)\/?(?:[?#].*)?$/i;
const CONV_PREFIX = /^conv[/:](.+)$/i;

interface ConversationLookupRow {
  id: number;
  name: string;
  tmuxSession: string;
  title: string | null;
  origin: 'local' | 'vault';
}

type ConversationLookupResult =
  | { ok: true; row: ConversationLookupRow | null }
  | { ok: false; message: string };

/**
 * Loads conversations.ts only on demand (NFR-2) — it pulls in
 * dashboard/server/event-store.js, which identity.ts must never import.
 * A DB failure is reported, never thrown: callers decide how to treat it
 * (Decision 6).
 */
async function lookupConversation(key: string): Promise<ConversationLookupResult> {
  try {
    const { getConversationById, getConversationByName } = await import('../lib/overdeck/conversations.js');
    const row = /^\d+$/.test(key) ? getConversationById(Number(key)) : getConversationByName(key);
    return { ok: true, row };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function resolveExplicitConversationForm(key: string, rawInput: string): Promise<AgentTargetResolution> {
  const lookup = await lookupConversation(key);
  if (!lookup.ok) {
    return { kind: 'unresolved', input: rawInput, reason: `conversation lookup failed: ${lookup.message}` };
  }
  if (!lookup.row) {
    return { kind: 'unresolved', input: rawInput, reason: `no conversation ${key}` };
  }
  if (lookup.row.origin === 'vault') {
    return { kind: 'unresolved', input: rawInput, reason: `conversation ${key} is a Session Vault copy and has no live agent` };
  }
  return { kind: 'agent', agentId: lookup.row.tmuxSession, via: 'conversation' };
}

function conversationCandidate(row: ConversationLookupRow): AgentTargetCandidate {
  return {
    explicitForm: `conv/${row.id}`,
    label: `conversation ${row.id} "${row.title ?? row.name}" (${row.tmuxSession})`,
  };
}

async function resolveBareDigits(input: string): Promise<AgentTargetResolution> {
  const issueMatches = listBareNumericIssueMatches(input);
  const lookup = await lookupConversation(input);
  const conversationRow = lookup.ok && lookup.row?.origin !== 'vault' ? lookup.row : null;

  if ((issueMatches.length >= 1 && conversationRow) || issueMatches.length >= 2) {
    const candidates: AgentTargetCandidate[] = issueMatches.map((issueId) => ({
      explicitForm: issueId,
      label: `issue ${issueId}`,
    }));
    if (conversationRow) candidates.push(conversationCandidate(conversationRow));
    return { kind: 'ambiguous', input, candidates };
  }
  if (issueMatches.length === 1) return { kind: 'issue', issueId: issueMatches[0] };
  if (conversationRow) return { kind: 'agent', agentId: conversationRow.tmuxSession, via: 'conversation' };
  return { kind: 'unresolved', input, reason: `no issue agent or conversation matches ${input}` };
}

/** Resolves a CLI target string to an agent, an issue (caller decides fan-out), or a failure (FR-1…FR-5). */
export async function resolveCliAgentTarget(input: string): Promise<AgentTargetResolution> {
  const urlMatch = input.match(CONV_URL);
  if (urlMatch) return resolveExplicitConversationForm(decodeURIComponent(urlMatch[1]), input);

  const prefixMatch = input.match(CONV_PREFIX);
  if (prefixMatch) return resolveExplicitConversationForm(prefixMatch[1], input);

  if (isQualifiedAgentId(input)) return { kind: 'agent', agentId: input.toLowerCase(), via: 'agent-id' };

  if (/^\d+$/.test(input)) return resolveBareDigits(input);

  return { kind: 'issue', issueId: resolveIssueId(input) };
}

/** For tell/pause/unpause/untroubled: collapses an `issue` result to its one agent (FR-6). */
export async function resolveCliSingleAgentId(
  input: string,
): Promise<{ ok: true; agentId: string } | { ok: false; failure: AgentTargetFailure }> {
  const resolution = await resolveCliAgentTarget(input);
  if (resolution.kind === 'agent') return { ok: true, agentId: resolution.agentId };
  if (resolution.kind === 'issue') {
    const agentId = resolveAgentTarget(resolution.issueId);
    if (agentId) return { ok: true, agentId };
    return { ok: false, failure: { kind: 'unresolved', input, reason: `no agent for ${resolution.issueId}` } };
  }
  return { ok: false, failure: resolution };
}

/** Prints the failure headline, candidates (ambiguous), and accepted forms to stderr (FR-5). */
export function printAgentTargetFailure(failure: AgentTargetFailure, verb: string): void {
  console.error(chalk.red(`Could not resolve agent target "${failure.input}"`));
  if (failure.kind === 'ambiguous') {
    console.error(chalk.dim(`  ${failure.input} matches more than one target. Pick one:`));
    for (const candidate of failure.candidates) {
      console.error(chalk.dim(`    ${candidate.explicitForm}    ${candidate.label}`));
    }
  } else {
    console.error(chalk.dim(`  ${failure.reason}`));
  }
  console.error(chalk.dim('Accepted targets:'));
  for (const line of ACCEPTED_TARGET_FORMS) {
    console.error(chalk.dim(`  ${line}`));
  }
  console.error(chalk.dim(`Run "pan ${verb} --help" for target syntax.`));
}
