import type {
  XBriefDocument,
  XBriefEdge,
  XBriefItem,
  XBriefItemStatus,
  XBriefPlan,
} from '../xbrief/types.js'
import type { ContinueSessionEntry, ContinueState } from '../xbrief/continue-state.js'

export const PAN_DIRNAME = '.pan'
export const WORKSPACE_RUNTIME_DIRNAME = '.overdeck'
export const LEGACY_WORKSPACE_RUNTIME_DIRNAME = '.pan'
export const PAN_SPECS_DIRNAME = 'specs'
export const PAN_DRAFTS_DIRNAME = 'drafts'
export const PAN_CONTINUES_DIRNAME = 'continues'
export const PAN_FEEDBACK_DIRNAME = 'feedback'
export const PAN_SPEC_FILENAME = 'spec.vbrief.json'
export const PENDING_PROMOTION_FILENAME = 'pending-promotion.json'
export const PAN_CONTINUE_FILENAME = 'continue.json'
export const PAN_SESSIONS_FILENAME = 'sessions.jsonl'
export const PAN_CONTEXT_FILENAME = 'context.md'

export type PanSpecStatus = 'proposed' | 'active' | 'completed' | 'cancelled'

export const PAN_SPEC_STATUSES = [
  'proposed',
  'active',
  'completed',
  'cancelled',
] as const satisfies readonly PanSpecStatus[]

export interface PanSpecDocument extends XBriefDocument {
  status: PanSpecStatus
}

export interface PanSpecListOptions {
  status?: PanSpecStatus
}

export interface PanSpecEntry {
  path: string
  filename: string
  issueId: string
  slug: string
  date: string
  status: PanSpecStatus
  document: PanSpecDocument
}

export interface PanSessionEntry extends ContinueSessionEntry {}

export interface WorkspaceContinueState extends ContinueState {
  statusOverrides?: Record<string, string>;
}

export interface PanFeedbackFile {
  path: string
  filename: string
  content: string
}

export interface WorkspacePanPaths {
  panDir: string
  specPath: string
  continuePath: string
  sessionsPath: string
  feedbackDir: string
  contextPath: string
}

export interface ProjectPanPaths {
  panDir: string
  specsDir: string
  draftsDir: string
  continuesDir: string
}

export function isPanSpecStatus(value: unknown): value is PanSpecStatus {
  return typeof value === 'string' && PAN_SPEC_STATUSES.includes(value as PanSpecStatus)
}

export function asPanSpecDocument(doc: XBriefDocument, status: PanSpecStatus): PanSpecDocument {
  return {
    ...doc,
    status,
    plan: {
      ...doc.plan,
      status,
    },
  }
}

export type {
  ContinueState,
  ContinueSessionEntry,
  XBriefDocument,
  XBriefEdge,
  XBriefItem,
  XBriefItemStatus,
  XBriefPlan,
}
