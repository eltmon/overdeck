/** Deacon patrol for releasing task claims whose local owner has died. */
import { hostname } from 'node:os';
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ProjectConfig } from '../projects.js';
import { listProjectsSync } from '../projects.js';
import { listAllAgentsSync } from '../overdeck/agents.js';
import { isPidDead } from '../pan-dir/fs-lock.js';
import { getIssueRecordPath, readIssueRecordSync } from '../pan-dir/record.js';
import { updateIssueRecord } from '../pan-dir/record-update.js';

export interface StaleClaimProject {
  project: ProjectConfig;
  issueIds: string[];
}

export async function releaseStaleTaskClaims(
  projects: StaleClaimProject[],
  runningAgentIds: ReadonlySet<string>,
  localHost = hostname(),
  now = new Date(),
): Promise<string[]> {
  const actions: string[] = [];
  for (const { project, issueIds } of projects) {
    for (const issueId of issueIds) {
      const snapshot = readIssueRecordSync(project, issueId);
      if (!snapshot?.tasks) continue;
      const candidates = Object.entries(snapshot.tasks.claims).filter(([, claim]) =>
        claim.host === localHost
        && isPidDead(claim.pid)
        && (!claim.agentId || !runningAgentIds.has(claim.agentId))
      );
      if (candidates.length === 0) continue;
      await updateIssueRecord(project, issueId, record => {
        if (!record.tasks) return record;
        for (const [itemId] of candidates) {
          const claim = record.tasks.claims[itemId];
          if (!claim || claim.host !== localHost || !isPidDead(claim.pid) || (claim.agentId && runningAgentIds.has(claim.agentId))) continue;
          const reason = `stale claim released (${claim.writerId} dead)`;
          record.statusOverrides = { ...(record.statusOverrides ?? {}), [itemId]: 'pending' };
          record.tasks.claimHistory = [...(record.tasks.claimHistory ?? []), {
            ...claim, itemId, outcome: 'released' as const, reason, releasedAt: now.toISOString(),
          }].slice(-50);
          record.tasks.statusReasons = { ...(record.tasks.statusReasons ?? {}), [itemId]: { reason, updatedAt: now.toISOString() } };
          delete record.tasks.claims[itemId];
          record.tasks.sequence += 1;
          actions.push(`[deacon] released stale task claim ${issueId.toUpperCase()}/${itemId} (${claim.writerId} dead)`);
        }
        return record;
      }, { writerId: 'deacon-stale-claim-patrol' });
    }
  }
  return actions;
}

export async function patrolStaleTaskClaims(): Promise<string[]> {
  const projects = listProjectsSync().map(({ config }) => {
    let issueIds: string[] = [];
    try {
      issueIds = readdirSync(dirname(getIssueRecordPath(config, '_')))
        .filter(name => name.endsWith('.json'))
        .map(name => name.slice(0, -5).toUpperCase());
    } catch { /* a project with no records has nothing to patrol */ }
    return { project: config, issueIds };
  });
  const running = new Set(listAllAgentsSync().filter(agent => agent.status === 'running' || agent.status === 'starting').map(agent => agent.id));
  return releaseStaleTaskClaims(projects, running);
}
