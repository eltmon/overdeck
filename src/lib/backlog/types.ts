export type NodeSize = 'XS' | 'S' | 'M' | 'L' | 'XL';
export type NodeImportance = 'critical' | 'high' | 'medium' | 'low';
export type NodeCondition = 'ok' | 'needs-refinement' | 'stale';
export type NodeGate = 'auto' | 'ready' | 'blocked';
export type NodePlanning = 'skip' | 'auto' | 'interactive';
export type EdgeType = 'unblocks' | 'informs';
export type EdgeSource = 'github-ref' | 'operator' | 'ai-inferred';
export type PassMode = 'creation' | 'incremental' | 'review';

export type SequenceNode = {
  issue: string;
  rank: number;
  size: NodeSize;
  importance: NodeImportance;
  score: number;
  condition: NodeCondition;
  dependsOn: string[];
  why: string;
  rationale?: string;
  gate: NodeGate;
  planning: NodePlanning;
};

export type SequenceEdge = {
  from: string;
  to: string;
  type: EdgeType;
  source: EdgeSource;
  confidence: number;
};

export type SequenceDoc = {
  version: string;
  project: string;
  generatedAt: string;
  model: string;
  pass: PassMode;
  lastReviewPass?: string;
  openCount: number;
  nodes: SequenceNode[];
  edges: SequenceEdge[];
};

export type SequenceParseError = { ok: false; error: string };
export type SequenceParseResult = { ok: true; doc: SequenceDoc } | SequenceParseError;

const NODE_SIZES = new Set<string>(['XS', 'S', 'M', 'L', 'XL']);
const NODE_IMPORTANCES = new Set<string>(['critical', 'high', 'medium', 'low']);
const NODE_CONDITIONS = new Set<string>(['ok', 'needs-refinement', 'stale']);
const NODE_GATES = new Set<string>(['auto', 'ready', 'blocked']);
const NODE_PLANNINGS = new Set<string>(['skip', 'auto', 'interactive']);
const EDGE_TYPES = new Set<string>(['unblocks', 'informs']);
const EDGE_SOURCES = new Set<string>(['github-ref', 'operator', 'ai-inferred']);
const PASS_MODES = new Set<string>(['creation', 'incremental', 'review']);

function err(msg: string): SequenceParseError {
  return { ok: false, error: msg };
}

function validateNode(n: Record<string, unknown>, i: number): { ok: true; node: SequenceNode } | SequenceParseError {
  if (typeof n.issue !== 'string' || !n.issue) return err(`nodes[${i}].issue missing`);
  if (typeof n.rank !== 'number') return err(`nodes[${i}].rank missing`);
  if (typeof n.size !== 'string' || !NODE_SIZES.has(n.size)) return err(`nodes[${i}].size invalid: ${n.size}`);
  if (typeof n.importance !== 'string' || !NODE_IMPORTANCES.has(n.importance)) return err(`nodes[${i}].importance invalid: ${n.importance}`);
  if (typeof n.score !== 'number') return err(`nodes[${i}].score missing`);
  if (typeof n.condition !== 'string' || !NODE_CONDITIONS.has(n.condition)) return err(`nodes[${i}].condition invalid: ${n.condition}`);
  if (!Array.isArray(n.dependsOn)) return err(`nodes[${i}].dependsOn missing`);
  if (typeof n.why !== 'string') return err(`nodes[${i}].why missing`);
  if (n.why.length > 140) return err(`nodes[${i}].why exceeds 140 chars`);
  if (typeof n.gate !== 'string' || !NODE_GATES.has(n.gate)) return err(`nodes[${i}].gate invalid: ${n.gate}`);
  if (typeof n.planning !== 'string' || !NODE_PLANNINGS.has(n.planning)) return err(`nodes[${i}].planning invalid: ${n.planning}`);
  if (n.rationale !== undefined && typeof n.rationale !== 'string') return err(`nodes[${i}].rationale must be string`);
  return {
    ok: true,
    node: {
      issue: n.issue,
      rank: n.rank,
      size: n.size as NodeSize,
      importance: n.importance as NodeImportance,
      score: n.score,
      condition: n.condition as NodeCondition,
      dependsOn: n.dependsOn as string[],
      why: n.why,
      rationale: n.rationale as string | undefined,
      gate: n.gate as NodeGate,
      planning: n.planning as NodePlanning,
    },
  };
}

function validateEdge(e: Record<string, unknown>, i: number): { ok: true; edge: SequenceEdge } | SequenceParseError {
  if (typeof e.from !== 'string') return err(`edges[${i}].from missing`);
  if (typeof e.to !== 'string') return err(`edges[${i}].to missing`);
  if (typeof e.type !== 'string' || !EDGE_TYPES.has(e.type)) return err(`edges[${i}].type invalid: ${e.type}`);
  if (typeof e.source !== 'string' || !EDGE_SOURCES.has(e.source)) return err(`edges[${i}].source invalid: ${e.source}`);
  if (typeof e.confidence !== 'number') return err(`edges[${i}].confidence missing`);
  return { ok: true, edge: { from: e.from, to: e.to, type: e.type as EdgeType, source: e.source as EdgeSource, confidence: e.confidence } };
}

export function parseSequenceJson(value: unknown): SequenceParseResult {
  if (typeof value !== 'object' || value === null) return err('value must be an object');
  const v = value as Record<string, unknown>;

  if (typeof v.version !== 'string') return err('version missing');
  if (typeof v.project !== 'string') return err('project missing');
  if (typeof v.generatedAt !== 'string') return err('generatedAt missing');
  if (typeof v.model !== 'string') return err('model missing');
  if (typeof v.pass !== 'string' || !PASS_MODES.has(v.pass)) return err(`pass invalid: ${v.pass}`);
  if (typeof v.openCount !== 'number') return err('openCount missing');
  if (!Array.isArray(v.nodes)) return err('nodes must be an array');
  if (!Array.isArray(v.edges)) return err('edges must be an array');

  const nodes: SequenceNode[] = [];
  for (let i = 0; i < v.nodes.length; i++) {
    const result = validateNode(v.nodes[i] as Record<string, unknown>, i);
    if (!result.ok) return result;
    nodes.push(result.node);
  }

  const edges: SequenceEdge[] = [];
  for (let i = 0; i < v.edges.length; i++) {
    const result = validateEdge(v.edges[i] as Record<string, unknown>, i);
    if (!result.ok) return result;
    edges.push(result.edge);
  }

  return {
    ok: true,
    doc: {
      version: v.version,
      project: v.project,
      generatedAt: v.generatedAt,
      model: v.model,
      pass: v.pass as PassMode,
      lastReviewPass: typeof v.lastReviewPass === 'string' ? v.lastReviewPass : undefined,
      openCount: v.openCount,
      nodes,
      edges,
    },
  };
}
