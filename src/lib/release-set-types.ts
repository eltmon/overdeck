import type { ReleaseComponentConfig } from './projects.js';

export type ReleaseSetStatus = 'pending' | 'releasing' | 'passed' | 'failed' | 'partial' | 'rolled_back' | 'skipped';
export type ReleaseComponentStatus = 'pending' | 'releasing' | 'passed' | 'failed' | 'skipped' | 'blocked' | 'rolled_back';
export type ReleaseCheckStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
export type RollbackStatus = ReleaseCheckStatus | 'rolled_back';

export interface ReleaseComponentState {
  componentKey: string;
  provider?: string;
  trigger: ReleaseComponentConfig['trigger'];
  releaseOrder: number;
  required: boolean;
  status: ReleaseComponentStatus;
  healthStatus?: ReleaseCheckStatus;
  versionStatus?: ReleaseCheckStatus;
  smokeStatus?: ReleaseCheckStatus;
  rollbackStatus?: RollbackStatus;
  notes?: string;
}

export interface ReleaseSet {
  issueId: string;
  projectKey: string;
  projectPath: string;
  workspaceType: 'monorepo' | 'polyrepo';
  status: ReleaseSetStatus;
  createdAt: string;
  updatedAt: string;
  components: ReleaseComponentState[];
}
