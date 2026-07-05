import { getReleaseSetFromDb } from './release-set-db.js';

export interface ReleaseSetComponentStatus {
  componentKey: string;
  provider: string;
  trigger: string;
  releaseOrder: number;
  required: boolean;
  status: string;
  healthStatus: string;
  versionStatus: string;
  smokeStatus: string;
  rollbackStatus: string;
  notes?: string;
}

export function getReleaseSetComponentsForIssueSync(issueId: string): ReleaseSetComponentStatus[] {
  return getReleaseSetFromDb(issueId)?.components.map(component => ({
    componentKey: component.componentKey,
    provider: component.provider ?? '',
    trigger: component.trigger,
    releaseOrder: component.releaseOrder,
    required: component.required,
    status: component.status,
    healthStatus: component.healthStatus,
    versionStatus: component.versionStatus,
    smokeStatus: component.smokeStatus,
    rollbackStatus: component.rollbackStatus,
    notes: component.notes,
  })) ?? [];
}
