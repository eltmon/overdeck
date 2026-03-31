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
    created: string;
  };
  plan: VBriefPlan;
}
