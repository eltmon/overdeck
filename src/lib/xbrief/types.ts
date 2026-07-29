/**
 * xBRIEF Type Definitions
 *
 * Conforms to xBRIEF v0.8 specification (https://github.com/deftai/xBRIEF).
 * Structured plan format produced by the planning agent and consumed by
 * Cloister for programmatic task execution and DAG visualization.
 *
 * v0.5 compatibility fields (PAN-453):
 *   - XBriefReference: external links (issues, PRDs, specs)
 *   - XBriefDocument.xBRIEFInfo: author (tool identifier), description
 *   - XBriefPlan: uid (UUID v4), sequence (write counter), references,
 *     created, updated timestamps
 *   - XBriefItem: created, completed timestamps
 *   - XBriefSubItem: created, completed timestamps
 *
 * Overdeck extensions (via metadata fields):
 *   - metadata.difficulty: trivial | simple | medium | complex | expert
 *   - metadata.kind: docs | api | backend | frontend | infra | test | refactor | design | spike
 *   - metadata.issueLabel: issue ID retained for compatibility with older plans
 *   - child metadata.kind: "acceptance_criterion" on child items
 */

export type XBriefEdgeType = 'blocks' | 'informs' | 'invalidates' | 'suggests';

// xBRIEF status enum
export type XBriefItemStatus = 'draft' | 'proposed' | 'approved' | 'pending' | 'running' | 'completed' | 'blocked' | 'cancelled' | 'failed';

export type XBriefPriority = 'critical' | 'high' | 'medium' | 'low';

export type XBriefDifficulty = 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';

export type XBriefItemKind = 'docs' | 'api' | 'backend' | 'frontend' | 'infra' | 'test' | 'refactor' | 'design' | 'spike';

export const DEFAULT_XBRIEF_ITEM_KIND: XBriefItemKind = 'backend';

export type FilesScopeConfidence = 'high' | 'medium' | 'low';

export type ItemReadiness = 'ready' | 'sequential' | 'needs_refinement';

export interface XBriefReference {
  uri: string;
  label?: string;
  type?: string;
}

export interface XBriefSubItem {
  id: string;
  title: string;
  status: XBriefItemStatus;
  /** ISO 8601 datetime, set when subItem is created */
  created?: string;
  /** ISO 8601 datetime, set when status transitions to 'completed' */
  completed?: string;
  metadata?: {
    kind?: string;
    [key: string]: unknown;
  };
}

export interface XBriefItemMetadata {
  difficulty?: XBriefDifficulty;
  kind?: XBriefItemKind;
  issueLabel?: string;
  phase?: number;
  /** Files/globs this item touches. Used for file-overlap enforcement during parallel dispatch. */
  files_scope?: string[];
  files_scope_confidence?: FilesScopeConfidence;
  verify_commands?: string[];
  expected_outputs?: string[];
  readiness?: ItemReadiness;
  /** True when this item has >1 blocking parent (DAG convergence point). Auto-derived by planner. */
  requiresSynthesis?: boolean;
  [key: string]: unknown;
}

export interface XBriefItem {
  id: string;
  title: string;
  status: XBriefItemStatus;
  priority?: XBriefPriority;
  /** ISO 8601 datetime, set when item is created */
  created?: string;
  /** ISO 8601 datetime, set when status transitions to 'completed' */
  completed?: string;
  /** RFC 3339 date-time (e.g., "2025-09-01T00:00:00Z"). NOT plain date. */
  startDate?: string;
  /** RFC 3339 date-time (e.g., "2025-11-15T00:00:00Z"). NOT plain date. */
  endDate?: string;
  /** RFC 3339 date-time (e.g., "2025-10-01T00:00:00Z"). NOT plain date. */
  dueDate?: string;
  metadata?: XBriefItemMetadata;
  narrative?: {
    Action?: string;
    [key: string]: string | undefined;
  };
  /** xBRIEF v0.6 child items. v0.5 documents used subItems for the same structure. */
  items?: XBriefSubItem[];
  /** Legacy xBRIEF v0.5 child items. Kept as a read alias for compatibility. */
  subItems?: XBriefSubItem[];
}

export interface XBriefEdge {
  from: string;
  to: string;
  type: XBriefEdgeType;
}

export interface XBriefPlan {
  id: string;
  title: string;
  status: string;
  author?: string;
  /** UUID v4, generated once at creation */
  uid?: string;
  /** Monotonically incrementing write counter, starts at 1 */
  sequence?: number;
  /** External references (PRDs, issues, specs) */
  references?: XBriefReference[];
  /** ISO 8601 datetime, set at plan creation */
  created?: string;
  /** ISO 8601 datetime, updated on every write */
  updated?: string;
  tags?: string[];
  autoDecisions?: Array<{
    summary: string;
    rationale?: string;
    [key: string]: unknown;
  }>;
  narratives?: {
    Problem?: string;
    Proposal?: string;
    Constraint?: string;
    Risk?: string;
    Alternative?: string;
    [key: string]: string | undefined;
  };
  /**
   * Overdeck-specific plan metadata. Free-form per-key storage for
   * lifecycle bookkeeping (e.g. canonicalFilename for the issue-keyed
   * filename convention).
   */
  metadata?: {
    /** Issue-keyed `.xbrief.json` filename used in `specs/` on `overdeck-state`. Set by plan finalization. */
    canonicalFilename?: string;
    /** Whether finalization should promote automatically or wait for an explicit operator action. */
    promotionIntent?: 'automatic' | 'manual';
    /** Why the plan carries no documentation item. Set only when the change alters no documented surface; waives the docs-item-missing quality gate. */
    docsJustification?: string;
    [key: string]: unknown;
  };
  items: XBriefItem[];
  edges: XBriefEdge[];
}

export const XBRIEF_INSPECTION_POLICIES = ['auto', 'never', 'fast', 'deep'] as const;
export type XBriefInspectionPolicy = typeof XBRIEF_INSPECTION_POLICIES[number];

export interface XBriefInfo {
  version: string;
  /** RFC 3339 date-time */
  created: string;
  /** RFC 3339 date-time */
  updated?: string;
  /** Tool identifier, e.g. "overdeck/0.6.0" */
  author?: string;
  /** Human-readable description of the plan */
  description?: string;
  /** Overdeck inspection routing policy. Defaults to auto when omitted. */
  inspectionPolicy?: XBriefInspectionPolicy;
}

export interface XBriefDocument {
  xBRIEFInfo: XBriefInfo;
  vBRIEFInfo?: XBriefInfo;
  plan: XBriefPlan;
}

export function subItemsOf(item: XBriefItem): XBriefSubItem[] {
  return item.items ?? item.subItems ?? [];
}

export function resolveXBriefItemKind(metadata?: Pick<XBriefItemMetadata, 'kind'>): XBriefItemKind {
  return metadata?.kind ?? DEFAULT_XBRIEF_ITEM_KIND;
}

/**
 * Validate that a string is RFC 3339 date-time format.
 * Accepts: "2025-09-01T00:00:00Z", "2025-09-01T12:30:00+05:00"
 * Rejects: "2025-09-01" (plain date — not RFC 3339 date-time)
 */
export function isRFC3339DateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(value);
}

/**
 * Convert a plain date (YYYY-MM-DD) to RFC 3339 date-time (midnight UTC).
 * Passes through values that are already RFC 3339.
 */
export function toRFC3339(value: string): string {
  if (isRFC3339DateTime(value)) return value;
  // Plain date → midnight UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;
  return value;
}
