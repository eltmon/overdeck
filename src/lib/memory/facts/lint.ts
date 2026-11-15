/**
 * `pan memory lint` report (PAN-5360 W10, D15, FR-9): link checks over every parsed
 * fact, then similarity and the contradiction pass over active facts only (a superseded
 * fact and its successor are similar by construction). Advisory: it reads one store and
 * never writes a file. Not imported by the launch path.
 */
import type { MemoryIdentity } from '@overdeck/contracts';
import {
  type ContradictionJudge,
  type ContradictionReport,
  defaultContradictionJudge,
  judgeContradictions,
} from './lint-contradictions.js';
import { findLinkProblems, type LinkFinding } from './lint-links.js';
import {
  defaultEmbedder,
  EMBEDDING_DUPLICATE_THRESHOLD,
  type Embedder,
  LEXICAL_DUPLICATE_THRESHOLD,
  type ScoredPair,
  scoreFactPairs,
} from './lint-similarity.js';
import {
  isActiveFact,
  type MemoryFactProblem,
  type MemoryFactScope,
  readMemoryFactsSync,
} from './store.js';

export interface MemoryLintReport {
  scope: MemoryFactScope;
  dir: string;
  factCount: number;
  activeCount: number;
  problems: MemoryFactProblem[];
  links: LinkFinding[];
  similarity: { method: 'lexical' | 'embedding'; model?: string; fallbackReason?: string; duplicateThreshold: number };
  duplicates: ScoredPair[];
  contradictions: ContradictionReport;
}

export async function lintMemoryFacts(input: {
  dir: string;
  scope: MemoryFactScope;
  /** Overrides the method's duplicate threshold (0 < n <= 1). */
  threshold?: number;
  llm: boolean;
  /** `undefined` uses the configured embedder; `null` forces lexical similarity. */
  embedder?: Embedder | null;
  /** Defaults to the memory extraction provider (D18). */
  judge?: ContradictionJudge;
  identity: MemoryIdentity;
}): Promise<MemoryLintReport> {
  const { facts, problems } = readMemoryFactsSync(input.dir, input.scope);
  const active = facts.filter(isActiveFact);

  let embedder = input.embedder ?? null;
  let unavailableReason: string | undefined;
  if (input.embedder === undefined) ({ embedder, unavailableReason } = defaultEmbedder());

  const similarity = await scoreFactPairs(active, embedder);
  const fallbackReason = similarity.fallbackReason ?? unavailableReason;
  const duplicateThreshold = input.threshold
    ?? (similarity.method === 'embedding' ? EMBEDDING_DUPLICATE_THRESHOLD : LEXICAL_DUPLICATE_THRESHOLD);

  const contradictions: ContradictionReport = input.llm
    ? await judgeContradictions({
      facts: new Map(active.map((fact) => [fact.id, fact])),
      candidates: similarity.pairs,
      judge: input.judge ?? defaultContradictionJudge(input.identity),
    })
    : { status: 'skipped', reason: 'llm disabled (--no-llm)', pairsChecked: 0, pairsFailed: 0, findings: [] };

  return {
    scope: input.scope,
    dir: input.dir,
    factCount: facts.length,
    activeCount: active.length,
    problems,
    links: findLinkProblems(facts),
    similarity: {
      method: similarity.method,
      ...(similarity.model !== undefined ? { model: similarity.model } : {}),
      ...(fallbackReason !== undefined ? { fallbackReason } : {}),
      duplicateThreshold,
    },
    duplicates: similarity.pairs.filter((pair) => pair.score >= duplicateThreshold),
    contradictions,
  };
}
