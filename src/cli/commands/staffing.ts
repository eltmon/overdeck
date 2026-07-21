import chalk from 'chalk';

import { resolveImplicitStaffing, resolveIssueWorkModel } from '../../lib/agents/staffing.js';
import { loadConfigSync } from '../../lib/config-yaml.js';
import { normalizeModelOverrideSync } from '../../lib/model-validation.js';
import {
  getProjectConfigFromWorkspacePath,
  resolveProjectForIssue,
} from '../../lib/pan-dir/record.js';
import { updateIssueRecord } from '../../lib/pan-dir/record-update.js';
import { resolveSwarmPolicy, type SwarmMode } from '../../lib/swarm-policy.js';

export interface StaffingOptions {
  model?: string;
  swarm?: string;
}

export async function staffingCommand(id: string, options: StaffingOptions): Promise<void> {
  const issueId = id.toUpperCase();
  const project = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(process.cwd());
  const hasMutation = options.model !== undefined || options.swarm !== undefined;

  let workModel: string | undefined;
  if (options.model !== undefined && options.model !== 'default') {
    try {
      workModel = normalizeModelOverrideSync(options.model);
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exitCode = 1;
      return;
    }
  }

  let swarmMode: SwarmMode | undefined;
  if (options.swarm !== undefined && options.swarm !== 'default') {
    if (!['off', 'auto', 'always'].includes(options.swarm)) {
      console.error(chalk.red(`Error: swarm must be off, auto, always, or default, got '${options.swarm}'`));
      process.exitCode = 1;
      return;
    }
    swarmMode = options.swarm as SwarmMode;
  }

  if (hasMutation) {
    await updateIssueRecord(project, issueId, (record) => {
      if (options.model !== undefined) record.workModel = workModel;
      if (options.swarm !== undefined) {
        const policy = { ...record.swarm?.policy };
        policy.mode = swarmMode;
        record.swarm = { ...record.swarm, policy: Object.values(policy).some((value) => value !== undefined) ? policy : undefined };
      }
    });
  }

  const issueModel = resolveIssueWorkModel(issueId);
  const implicit = resolveImplicitStaffing(loadConfigSync().config, `work:${issueId.toLowerCase()}`);
  const swarm = resolveSwarmPolicy(issueId);
  console.log(`Work model: ${issueModel ?? implicit.model} (source: ${issueModel ? 'issue' : 'default'})`);
  console.log(`Swarm mode: ${swarm.mode} (source: ${swarm.source.mode})`);
}
