/**
 * vBRIEF Type Definitions
 *
 * Conforms to vBRIEF v0.6 specification (https://github.com/deftai/vBRIEF).
 * Structured plan format produced by the planning agent and consumed by
 * Cloister for programmatic beads creation and DAG visualization.
 *
 * v0.5 compatibility fields (PAN-453):
 *   - VBriefReference: external links (issues, PRDs, specs)
 *   - VBriefDocument.vBRIEFInfo: author (tool identifier), description
 *   - VBriefPlan: uid (UUID v4), sequence (write counter), references,
 *     created, updated timestamps
 *   - VBriefItem: created, completed timestamps
 *   - VBriefSubItem: created, completed timestamps
 *
 * Overdeck extensions (via metadata fields):
 *   - metadata.difficulty: trivial | simple | medium | complex | expert
 *   - metadata.kind: docs | api | backend | frontend | infra | test | refactor | design | spike
 *   - metadata.issueLabel: issue ID for beads label filtering
 *   - child metadata.kind: "acceptance_criterion" on child items
 */

export type VBriefEdgeType = 'blocks' | 'informs' | 'invalidates' | 'suggests';

// vBRIEF status enum
export type VBriefItemStatus = 'draft' | 'proposed' | 'approved' | 'pending' | 'running' | 'completed' | 'blocked' | 'cancelled' | 'failed';

export type VBriefPriority = 'critical' | 'high' | 'medium' | 'low';

export type VBriefDifficulty = 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';

export type VBriefItemKind = 'docs' | 'api' | 'backend' | 'frontend' | 'infra' | 'test' | 'refactor' | 'design' | 'spike';

export type FilesScopeConfidence = 'high' | 'medium' | 'low';

export type ItemReadiness = 'ready' | 'sequential' | 'needs_refinement';

export interface VBriefReference {
  uri: string;
  label?: string;
  type?: string;
}

export interface VBriefSubItem {
  id: string;
  title: string;
  status: VBriefItemStatus;
  /** ISO 8601 datetime, set when subItem is created */
  created?: string;
  /** ISO 8601 datetime, set when status transitions to 'completed' */
  completed?: string;
  metadata?: {
    kind?: string;
    [key: string]: unknown;
  };
}

export interface VBriefItemMetadata {
  difficulty?: VBriefDifficulty;
  kind?: VBriefItemKind;
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

export interface VBriefItem {
  id: string;
  title: string;
  status: VBriefItemStatus;
  priority?: VBriefPriority;
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
  metadata?: VBriefItemMetadata;
  narrative?: {
    Action?: string;
    [key: string]: string | undefined;
  };
  /** vBRIEF v0.6 child items. v0.5 documents used subItems for the same structure. */
  items?: VBriefSubItem[];
  /** Legacy vBRIEF v0.5 child items. Kept as a read alias for compatibility. */
  subItems?: VBriefSubItem[];
}

export interface VBriefEdge {
  from: string;
  to: string;
  type: VBriefEdgeType;
}

export interface VBriefPlan {
  id: string;
  title: string;
  status: string;
  author?: string;
  /** UUID v4, generated once at creation */
  uid?: string;
  /** Monotonically incrementing write counter, starts at 1 */
  sequence?: number;
  /** External references (PRDs, issues, specs) */
  references?: VBriefReference[];
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
    /** Issue-keyed filename used in `./vbrief/<lifecycle>/`. Set by plan-finalize. */
    canonicalFilename?: string;
    [key: string]: unknown;
  };
  items: VBriefItem[];
  edges: VBriefEdge[];
}

export const VBRIEF_INSPECTION_POLICIES = ['auto', 'never', 'fast', 'deep'] as const;
export type VBriefInspectionPolicy = typeof VBRIEF_INSPECTION_POLICIES[number];

export interface VBriefDocument {
  vBRIEFInfo: {
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
    inspectionPolicy?: VBriefInspectionPolicy;
  };
  plan: VBriefPlan;
}

export function subItemsOf(item: VBriefItem): VBriefSubItem[] {
  return item.items ?? item.subItems ?? [];
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
