import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { listConversations, type LegacyConversation as Conversation } from '../../../lib/overdeck/conversations.js';
import { getRuntimeCensus } from '../../../lib/runtime-census.js';

const execFileAsync = promisify(execFile);

export interface TrackerIssueRecord {
  identifier?: string;
  title?: string;
  state?: string;
  status?: string;
  rawTrackerState?: string;
  source?: string;
  totalChildCount?: number;
  completedChildCount?: number;
  inProgressChildCount?: number;
}

interface ActiveRemoteAgentState {
  issueId: string;
  vmName: string;
  status: string;
  model: string;
  startedAt: string;
}

export interface SharedResourceSignals {
  trackerIssues: Map<string, TrackerIssueRecord>;
  tmuxSessions: string[];
  dockerContainers: string[];
  conversations: Conversation[];
  remoteAgentStates: ActiveRemoteAgentState[];
}

async function loadTrackerIssues(): Promise<Map<string, TrackerIssueRecord>> {
  const map = new Map<string, TrackerIssueRecord>();
  try {
    const { getSharedIssueService } = await import('./issue-service-singleton.js');
    const service = await getSharedIssueService();
    const issues = service.getIssues() as TrackerIssueRecord[];
    for (const issue of issues) {
      if (issue.identifier) map.set(issue.identifier.toUpperCase(), issue);
    }
  } catch {
    // A cold issue service contributes no tracker signals to this snapshot.
  }
  return map;
}

async function loadDockerContainers(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('docker', ['ps', '--format', '{{.Names}}'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function loadActiveRemoteAgentStates(): Promise<ActiveRemoteAgentState[]> {
  try {
    const { listActiveRemoteAgentStates } = await import('../../../lib/remote/remote-agents.js');
    return listActiveRemoteAgentStates();
  } catch {
    return [];
  }
}

export async function captureSharedResourceSignals(): Promise<SharedResourceSignals> {
  const [trackerIssues, runtimeCensus, dockerContainers, remoteAgentStates] = await Promise.all([
    loadTrackerIssues(),
    getRuntimeCensus(),
    loadDockerContainers(),
    loadActiveRemoteAgentStates(),
  ]);
  const tmuxSessions = [...runtimeCensus.sessionNames];
  let conversations: Conversation[] = [];
  try {
    conversations = listConversations();
  } catch {
    // Conversation state is optional for resource discovery.
  }
  return { trackerIssues, tmuxSessions, dockerContainers, conversations, remoteAgentStates };
}
