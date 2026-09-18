/**
 * `pan staffing <id>` — show the work model and swarm policy an issue resolves to.
 *
 * PAN-3917: read-only. The per-issue override layer lived only on the pipeline
 * record, so `--model` and `--swarm` are gone; staffing now resolves from
 * config.yaml and the project's `projects.yaml` entry, and a one-off model for
 * a single session is passed at spawn time (`pan start --model`).
 */
import chalk from 'chalk';

import { resolveImplicitStaffing, resolveIssueWorkModel } from '../../lib/agents/staffing.js';
import { loadConfigSync } from '../../lib/config-yaml.js';
import { resolveSwarmPolicy } from '../../lib/swarm-policy.js';

export async function staffingCommand(id: string): Promise<void> {
  const issueId = id.toUpperCase();
  const issueModel = resolveIssueWorkModel(issueId);
  const implicit = resolveImplicitStaffing(loadConfigSync().config, `work:${issueId.toLowerCase()}`);
  const swarm = resolveSwarmPolicy(issueId);
  console.log(`Work model: ${issueModel ?? implicit.model} (source: ${issueModel ? 'issue' : 'default'})`);
  console.log(`Swarm mode: ${swarm.mode} (source: ${swarm.source.mode})`);
  console.log(chalk.dim('Per-issue overrides were removed with the record plane; set defaults in config.yaml.'));
}
