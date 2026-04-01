/**
 * vBRIEF Type Definitions
 *
 * Structured plan format produced by the planning agent and consumed by
 * Cloister for programmatic beads creation and DAG visualization.
 */

export type VBriefEdgeType = 'blocks' | 'informs' | 'invalidates' | 'suggests';

export type VBriefItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'blocked';

export type VBriefPriority = 'critical' | 'high' | 'medium' | 'low';

export type VBriefDifficulty = 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';

export interface VBriefSubItem {
  id: string;
  title: string;
  status: VBriefItemStatus;
  metadata?: {
    kind?: string;
    [key: string]: unknown;
  };
}

export interface VBriefItem {
  id: string;
  title: string;
  status: VBriefItemStatus;
  priority?: VBriefPriority;
  /** RFC 3339 date-time (e.g., "2025-09-01T00:00:00Z"). NOT plain date. */
  startDate?: string;
  /** RFC 3339 date-time (e.g., "2025-11-15T00:00:00Z"). NOT plain date. */
  endDate?: string;
  /** RFC 3339 date-time (e.g., "2025-10-01T00:00:00Z"). NOT plain date. */
  dueDate?: string;
  metadata?: {
    difficulty?: VBriefDifficulty;
    issueLabel?: string;
    phase?: number;
    [key: string]: unknown;
  };
  narrative?: {
    Action?: string;
    [key: string]: string | undefined;
  };
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
  tags?: string[];
  narratives?: {
    Problem?: string;
    Proposal?: string;
    Constraint?: string;
    Risk?: string;
    Alternative?: string;
    [key: string]: string | undefined;
  };
  items: VBriefItem[];
  edges: VBriefEdge[];
}

export interface VBriefDocument {
  vBRIEFInfo: {
    version: string;
    /** RFC 3339 date-time */
    created: string;
    /** RFC 3339 date-time */
    updated?: string;
  };
  plan: VBriefPlan;
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
