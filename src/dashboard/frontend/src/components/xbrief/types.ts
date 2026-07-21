/**
 * xBRIEF frontend types — extended with all new fields
 * Used by XBriefViewer and related components.
 */

export type XBriefItemStatus = 'draft' | 'proposed' | 'approved' | 'pending' | 'running' | 'completed' | 'blocked' | 'cancelled' | 'failed' | 'in_progress';
export type XBriefPriority = 'critical' | 'high' | 'medium' | 'low';
export type XBriefDifficulty = 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';
export type XBriefInspectionPolicy = 'auto' | 'never' | 'fast' | 'deep';
export type TieredExecutionSource = 'global' | 'issue-override' | 'plan-metadata';

export interface XBriefReference {
  uri: string;
  label?: string;
  type?: string;
}

export interface XBriefSubItem {
  id: string;
  title: string;
  status: string;
  created?: string;
  completed?: string;
  metadata?: { kind?: string; [key: string]: unknown };
}

export interface XBriefItem {
  id: string;
  title: string;
  status: XBriefItemStatus;
  priority?: XBriefPriority;
  created?: string;
  completed?: string;
  metadata?: { difficulty?: XBriefDifficulty; [key: string]: unknown };
  narrative?: { Action?: string; [key: string]: string | undefined };
  items?: XBriefSubItem[];
  subItems?: XBriefSubItem[];
}

export interface XBriefEdge {
  from: string;
  to: string;
  type: 'blocks' | 'informs' | 'invalidates' | 'suggests';
}

export interface XBriefPlan {
  id: string;
  title: string;
  status: string;
  metadata?: { tiered_execution?: 'on' | 'off'; [key: string]: unknown };
  /** PAN-2383: computed by the plan read door (effective tiered-execution
   * state + where it came from). Optional until the read-door task lands. */
  tieredExecution?: { effective: boolean; source: TieredExecutionSource; override: 'on' | 'off' | null };
  author?: string;
  uid?: string;
  sequence?: number;
  references?: XBriefReference[];
  created?: string;
  updated?: string;
  tags?: string[];
  narratives?: {
    Problem?: string;
    Proposal?: string;
    Constraint?: string;
    Risk?: string;
    Alternative?: string;
    [key: string]: string | undefined;
  };
  items: XBriefItem[];
  edges: XBriefEdge[];
}

export interface XBriefDocument {
  xBRIEFInfo: {
    version: string;
    created: string;
    updated?: string;
    author?: string;
    description?: string;
    inspectionPolicy?: XBriefInspectionPolicy;
  };
  plan: XBriefPlan;
  criticalPath?: string[];
}
