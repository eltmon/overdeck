/**
 * vBRIEF v0.5 frontend types — extended with all new fields
 * Used by VBriefViewer and related components.
 */

export type VBriefItemStatus = 'draft' | 'proposed' | 'approved' | 'pending' | 'running' | 'completed' | 'blocked' | 'cancelled' | 'in_progress';
export type VBriefPriority = 'critical' | 'high' | 'medium' | 'low';
export type VBriefDifficulty = 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';
export type VBriefInspectionPolicy = 'auto' | 'never' | 'fast' | 'deep';

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
