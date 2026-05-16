import { randomUUID } from 'crypto';
import { appendFile, readFile } from 'fs/promises';
import type { MemoryIdentity, MemoryStatus, RagDecision, RagDecisionSource } from '@panctl/contracts';
import { ensureParentDir, resolveRagRunsFile, resolveStatusFile } from './paths.js';
import { expandMemoryQuery, type QueryExpansionCall, type QueryExpansionResult } from './query-expansion.js';
import { searchMemory, type MemorySearchHit } from './search.js';
import { isMemoryPromptTimeInjectionEnabled } from './settings.js';

export const PROMPT_TIME_MEMORY_BUDGETS = {
  status: 2000,
  observations: 5000,
  summaries: 500,
  sibling: 1500,
} as const;

export interface PromptTimeMemoryInjectionInput {
  prompt: string;
  identity: MemoryIdentity;
  previousObservations?: Parameters<typeof expandMemoryQuery>[0]['previousObservations'];
  now?: Date;
  id?: string;
  budgets?: Partial<MemoryBudgets>;
  expansion?: QueryExpansionCall;
  loadPromptTimeEnabled?: () => boolean | Promise<boolean>;
  loadStatus?: (projectId: string, issueId: string) => Promise<MemoryStatus | null>;
  search?: typeof searchMemory;
  logDecision?: (entry: PromptTimeRagDecisionLogEntry) => Promise<void>;
}

export interface PromptTimeRagDecisionLogEntry extends RagDecision {
  type: 'rag-decision';
  hitCounts: {
    status: number;
    observations: number;
    summaries: number;
    sibling: number;
  };
  budgets: MemoryBudgets;
  allocationBytes: MemoryAllocations;
  expansion: Pick<QueryExpansionResult, 'status' | 'reason' | 'cacheKey'>;
}

export interface PromptTimeMemoryInjectionResult {
  status: RagDecision['outcome'];
  reason: string | null;
  context: string;
  decision: PromptTimeRagDecisionLogEntry;
}

type BudgetKey = 'status' | 'observations' | 'summaries' | 'sibling';
type MemoryBudgets = Record<BudgetKey, number>;
type MemoryAllocations = Record<BudgetKey, number>;

interface CandidateContext {
  key: BudgetKey;
  source: RagDecisionSource;
  title: string;
  text: string;
}

export async function injectPromptTimeMemory(input: PromptTimeMemoryInjectionInput): Promise<PromptTimeMemoryInjectionResult> {
  const now = input.now ?? new Date();
  const budgets: MemoryBudgets = { ...PROMPT_TIME_MEMORY_BUDGETS, ...input.budgets };
  const enabled = await (input.loadPromptTimeEnabled ?? isMemoryPromptTimeInjectionEnabled)();

  if (!enabled) {
    return finalize(input, now, budgets, {
      outcome: 'skipped',
      reason: 'prompt-time-injection-disabled',
      query: input.prompt,
      expandedTerms: [],
      expansion: { query: input.prompt, expandedTerms: [], cacheKey: '', status: 'fallback', reason: null },
      candidates: [],
      selected: [],
      allocationBytes: emptyAllocations(),
      hitCounts: emptyHitCounts(),
    });
  }

  let expansion: QueryExpansionResult;
  try {
    expansion = await expandMemoryQuery({
      prompt: input.prompt,
      identity: input.identity,
      previousObservations: input.previousObservations,
      now,
      id: input.id,
      expand: input.expansion,
    });
  } catch {
    expansion = {
      query: input.prompt,
      expandedTerms: [],
      cacheKey: '',
      status: 'fallback',
      reason: 'extraction-failed',
    };
  }

  const search = input.search ?? searchMemory;
  const [status, sameProjectHits, siblingHits] = await Promise.all([
    (input.loadStatus ?? readStatus)(input.identity.projectId, input.identity.issueId).catch(() => null),
    search({
      query: expansion.query,
      projectId: input.identity.projectId,
      workspaceId: input.identity.workspaceId,
      issueId: input.identity.issueId,
      limit: 12,
    }).catch(() => []),
    search({
      query: expansion.query,
      projectId: input.identity.projectId,
      workspaceId: input.identity.workspaceId,
      issueId: input.identity.issueId,
      sibling: true,
      siblingTokenBudget: budgets.sibling,
      limit: 6,
    }).catch(() => []),
  ]);

  const candidates = [
    ...status ? [statusCandidate(status, input.identity)] : [],
    ...sameProjectHits.map(hitCandidate),
    ...siblingHits.map(siblingCandidate),
  ];
  const hitCounts = countHits(status, sameProjectHits, siblingHits);

  if (candidates.length === 0) {
    return finalize(input, now, budgets, {
      outcome: expansion.status === 'fallback' ? 'expansion-failed' : 'no-hits',
      reason: expansion.reason ?? 'no-memory-hits',
      query: expansion.query,
      expandedTerms: expansion.expandedTerms,
      expansion,
      candidates,
      selected: [],
      allocationBytes: emptyAllocations(),
      hitCounts,
    });
  }

  const selection = selectWithinBudgets(candidates, budgets);
  if (selection.selected.length === 0) {
    return finalize(input, now, budgets, {
      outcome: 'context-too-large',
      reason: 'memory-context-exceeds-token-budget',
      query: expansion.query,
      expandedTerms: expansion.expandedTerms,
      expansion,
      candidates,
      selected: [],
      allocationBytes: selection.allocationBytes,
      hitCounts,
    });
  }

  return finalize(input, now, budgets, {
    outcome: selection.truncated ? 'budget-truncated' : 'injected',
    reason: selection.truncated ? 'memory-context-truncated-to-budget' : expansion.reason,
    query: expansion.query,
    expandedTerms: expansion.expandedTerms,
    expansion,
    candidates,
    selected: selection.selected,
    allocationBytes: selection.allocationBytes,
    hitCounts,
  });
}

function statusCandidate(status: MemoryStatus, identity: MemoryIdentity): CandidateContext {
  const text = [
    `Headline: ${status.headline}`,
    `Summary: ${status.summary}`,
    status.goal ? `Goal: ${status.goal}` : '',
    status.accomplished.length ? `Accomplished: ${status.accomplished.join('; ')}` : '',
    status.decided.length ? `Decisions: ${status.decided.join('; ')}` : '',
    status.open.length ? `Open: ${status.open.join('; ')}` : '',
    status.nextSteps.length ? `Next steps: ${status.nextSteps.join('; ')}` : '',
    status.workingSet.length ? `Working set: ${status.workingSet.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  return {
    key: 'status',
    title: `Status: ${status.name}`,
    text,
    source: {
      id: `status:${identity.projectId}:${identity.issueId}`,
      docType: 'status',
      scope: 'issue',
      score: status.confidence,
      tokens: estimateTokens(text),
    },
  };
}

function hitCandidate(hit: MemorySearchHit): CandidateContext {
  const summary = hit.docType === 'summary';
  return {
    key: summary ? 'summaries' : 'observations',
    title: `${summary ? 'Summary' : 'Observation'}: ${hit.provenance}`,
    text: hit.displayContent || hit.content,
    source: {
      id: `memory_fts:${hit.rowid}`,
      docType: summary ? 'summary' : 'observation',
      scope: hit.scope,
      score: hit.rankScore,
      tokens: estimateTokens(hit.displayContent || hit.content),
    },
  };
}

function siblingCandidate(hit: MemorySearchHit): CandidateContext {
  const text = [
    `Provenance: ${hit.provenance}`,
    hit.displayContent || hit.content,
  ].join('\n');
  return {
    key: 'sibling',
    title: `Sibling: ${hit.provenance}`,
    text,
    source: {
      id: `memory_fts:${hit.rowid}`,
      docType: 'sibling',
      scope: hit.scope,
      score: hit.rankScore,
      tokens: estimateTokens(text),
    },
  };
}

function selectWithinBudgets(candidates: CandidateContext[], budgets: MemoryBudgets): {
  selected: CandidateContext[];
  allocationBytes: PromptTimeRagDecisionLogEntry['allocationBytes'];
  truncated: boolean;
} {
  const remaining = { ...budgets };
  const allocationBytes = emptyAllocations();
  const selected: CandidateContext[] = [];
  let truncated = false;

  for (const candidate of candidates) {
    const available = remaining[candidate.key];
    if (available <= 0) {
      truncated = true;
      continue;
    }

    const tokens = estimateTokens(candidate.text);
    if (tokens <= available) {
      remaining[candidate.key] -= tokens;
      allocationBytes[candidate.key] += Buffer.byteLength(candidate.text, 'utf8');
      selected.push(candidate);
      continue;
    }

    const truncatedText = truncateToTokens(candidate.text, available);
    if (!truncatedText) {
      truncated = true;
      continue;
    }

    remaining[candidate.key] = 0;
    allocationBytes[candidate.key] += Buffer.byteLength(truncatedText, 'utf8');
    selected.push({
      ...candidate,
      text: truncatedText,
      source: { ...candidate.source, tokens: estimateTokens(truncatedText) },
    });
    truncated = true;
  }

  return { selected, allocationBytes, truncated };
}

async function finalize(
  input: PromptTimeMemoryInjectionInput,
  now: Date,
  budgets: MemoryBudgets,
  state: {
    outcome: RagDecision['outcome'];
    reason: string | null;
    query: string;
    expandedTerms: string[];
    expansion: QueryExpansionResult;
    candidates: CandidateContext[];
    selected: CandidateContext[];
    allocationBytes: PromptTimeRagDecisionLogEntry['allocationBytes'];
    hitCounts: PromptTimeRagDecisionLogEntry['hitCounts'];
  },
): Promise<PromptTimeMemoryInjectionResult> {
  const allocations = selectedAllocations(state.selected);
  const decision: PromptTimeRagDecisionLogEntry = {
    id: input.id ?? randomUUID(),
    timestamp: now.toISOString(),
    type: 'rag-decision',
    identity: input.identity,
    surface: 'user-prompt',
    outcome: state.outcome,
    query: state.query,
    expandedTerms: state.expandedTerms,
    allocations,
    sources: state.selected.map((candidate) => candidate.source),
    reason: state.reason,
    hitCounts: state.hitCounts,
    budgets,
    allocationBytes: state.allocationBytes,
    expansion: {
      status: state.expansion.status,
      reason: state.expansion.reason,
      cacheKey: state.expansion.cacheKey,
    },
  };

  await writeDecision(input, decision);
  return {
    status: decision.outcome,
    reason: decision.reason,
    context: buildContext(state.selected),
    decision,
  };
}

function selectedAllocations(candidates: CandidateContext[]): RagDecision['allocations'] {
  const allocations = emptyAllocations();
  for (const candidate of candidates) {
    allocations[candidate.key] += estimateTokens(candidate.text);
  }
  return allocations;
}

function buildContext(candidates: CandidateContext[]): string {
  if (candidates.length === 0) return '';
  return [
    '<panopticon-memory-context>',
    'Relevant durable memory for this prompt:',
    '',
    ...candidates.map((candidate) => [
      `## ${candidate.title}`,
      candidate.text,
    ].join('\n')),
    '</panopticon-memory-context>',
  ].join('\n\n');
}

async function writeDecision(input: PromptTimeMemoryInjectionInput, decision: PromptTimeRagDecisionLogEntry): Promise<void> {
  if (input.logDecision) {
    await input.logDecision(decision);
    return;
  }

  const filePath = resolveRagRunsFile(input.identity.projectId, input.identity.issueId, decision.timestamp);
  await ensureParentDir(filePath);
  await appendFile(filePath, `${JSON.stringify(decision)}\n`, 'utf8');
}

async function readStatus(projectId: string, issueId: string): Promise<MemoryStatus | null> {
  try {
    return JSON.parse(await readFile(resolveStatusFile(projectId, issueId), 'utf8')) as MemoryStatus;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function countHits(status: MemoryStatus | null, sameProjectHits: MemorySearchHit[], siblingHits: MemorySearchHit[]): PromptTimeRagDecisionLogEntry['hitCounts'] {
  return {
    status: status ? 1 : 0,
    observations: sameProjectHits.filter((hit) => hit.docType !== 'summary').length,
    summaries: sameProjectHits.filter((hit) => hit.docType === 'summary').length,
    sibling: siblingHits.length,
  };
}

function emptyAllocations(): MemoryAllocations {
  return { status: 0, observations: 0, summaries: 0, sibling: 0 };
}

function emptyHitCounts(): PromptTimeRagDecisionLogEntry['hitCounts'] {
  return { status: 0, observations: 0, summaries: 0, sibling: 0 };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, tokens: number): string {
  const charBudget = Math.max(0, tokens * 4);
  if (charBudget <= 0) return '';
  if (text.length <= charBudget) return text;
  return text.slice(0, charBudget).trimEnd();
}
