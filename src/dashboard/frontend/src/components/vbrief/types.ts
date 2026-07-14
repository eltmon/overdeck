/**
 * vBRIEF frontend types — extended with all new fields
 * Used by VBriefViewer and related components.
 */

export type VBriefItemStatus = 'draft' | 'proposed' | 'approved' | 'pending' | 'running' | 'completed' | 'blocked' | 'cancelled' | 'failed' | 'in_progress';
export type VBriefPriority = 'critical' | 'high' | 'medium' | 'low';
export type VBriefDifficulty = 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';
export type VBriefInspectionPolicy = 'auto' | 'never' | 'fast' | 'deep';
export type TieredExecutionSource = 'global' | 'issue-override' | 'plan-metadata';

export interface VBriefReference {
  uri: string;
  label?: string;
  type?: string;
}

export interface VBriefSubItem {
  id: string;
  title: string;
  status: string;
  created?: string;
  completed?: string;
  metadata?: { kind?: string; [key: string]: unknown };
}

export interface VBriefItem {
  id: string;
  title: string;
  status: VBriefItemStatus;
  priority?: VBriefPriority;
  created?: string;
  completed?: string;
  metadata?: { difficulty?: VBriefDifficulty; [key: string]: unknown };
  narrative?: { Action?: string; [key: string]: string | undefined };
  items?: VBriefSubItem[];
  subItems?: VBriefSubItem[];
}

export interface VBriefEdge {
  from: string;
  to: string;
  type: 'blocks' | 'informs' | 'invalidates' | 'suggests';
}

export interface VBriefPlan {
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
  references?: VBriefReference[];
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
  items: VBriefItem[];
  edges: VBriefEdge[];
}

export interface VBriefDocument {
  vBRIEFInfo: {
    version: string;
    created: string;
    updated?: string;
    author?: string;
    description?: string;
    inspectionPolicy?: VBriefInspectionPolicy;
  };
  plan: VBriefPlan;
  criticalPath?: string[];
}
