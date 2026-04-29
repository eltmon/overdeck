import type { AgentStatus } from '@panctl/contracts';

export function normalizeAgentStatus(status: string): AgentStatus {
  switch (status) {
    case 'running':
    case 'active':
    case 'reviewing':
    case 'testing':
    case 'merging':
    case 'verifying':
      return 'running';
    case 'completed':
    case 'passed':
    case 'queued':
    case 'merged':
    case 'suspended':
    case 'stopped':
      return 'stopped';
    case 'failed':
    case 'blocked':
    case 'commented':
    case 'changes-requested':
    case 'dispatch_failed':
    case 'error':
      return 'error';
    case 'unknown':
      return 'unknown';
    default:
      return 'unknown';
  }
}
