import { getReviewStatusSync } from '../review-status.js';
import type { XBriefDocument, XBriefItem } from '../xbrief/types.js';

const BLOCKING_INSPECTION_STATUSES = new Set(['failed', 'blocked', 'error', 'inspecting']);

export interface BlockingMandatoryInspection {
  item: XBriefItem;
  status: string;
  notes?: string;
}

export function getBlockingMandatoryInspection(
  plan: XBriefDocument,
  issueId: string,
): BlockingMandatoryInspection | null {
  const inspection = getReviewStatusSync(issueId);
  const status = inspection?.inspectStatus as string | undefined;
  if (!status || !BLOCKING_INSPECTION_STATUSES.has(status) || !inspection?.inspectBeadId) return null;

  const item = plan.plan.items.find(candidate => candidate.id === inspection.inspectBeadId);
  if (item?.status !== 'completed' || item.metadata?.requiresInspection !== true) return null;

  return { item, status, notes: inspection.inspectNotes };
}

export function buildInspectionBlockedNudge(
  issueId: string,
  inspection: BlockingMandatoryInspection,
): string {
  const lines = [
    `Deacon idle-nudge: mandatory inspection blocks further task advancement for ${issueId}.`,
    '',
    `Inspection item: ${inspection.item.id} ${inspection.item.title}`,
    `Inspection status: ${inspection.status}`,
    `Actionable inspection notes: ${inspection.notes?.trim() || 'No inspection notes were recorded.'}`,
    '',
  ];

  if (inspection.status === 'failed' || inspection.status === 'blocked') {
    lines.push(
      `You must fix ${inspection.item.id}, commit and push the correction, then re-run \`pan inspect ${issueId} --item ${inspection.item.id}\`. Do not claim or implement another task until inspection passes.`,
    );
  } else if (inspection.status === 'error') {
    lines.push(
      `Resolve or report the inspection infrastructure failure, then re-run \`pan inspect ${issueId} --item ${inspection.item.id}\`; do not advance to another task until inspection passes.`,
    );
  } else {
    lines.push(
      `Wait for the inspection verdict for ${inspection.item.id}; do not advance to another task until inspection passes.`,
    );
  }

  return lines.join('\n');
}
