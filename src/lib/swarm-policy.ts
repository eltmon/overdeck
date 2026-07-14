import { loadConfigSync } from './config-yaml.js';
import { getProjectSync, resolveProjectFromIssueSync } from './projects.js';
import { readIssueRecordSync } from './pan-dir/record.js';

export type SwarmMode = 'off' | 'auto' | 'always';
export interface SwarmPolicyLayer { mode?: SwarmMode; maxSlots?: number; autoAdvance?: boolean }
export interface ResolvedSwarmPolicy {
  mode: SwarmMode;
  maxSlots: number;
  autoAdvance: boolean;
  source: { mode: string; maxSlots: string; autoAdvance: string };
}

export function resolveSwarmPolicyLayers(global: SwarmPolicyLayer = {}, project: SwarmPolicyLayer = {}, issue: SwarmPolicyLayer = {}, cli: SwarmPolicyLayer = {}): ResolvedSwarmPolicy {
  const resolve = <K extends keyof SwarmPolicyLayer>(key: K, fallback: NonNullable<SwarmPolicyLayer[K]>) => {
    for (const [source, layer] of [['cli', cli], ['issue', issue], ['project', project], ['global', global]] as const) {
      if (layer[key] !== undefined) return { value: layer[key] as NonNullable<SwarmPolicyLayer[K]>, source };
    }
    return { value: fallback, source: 'default' };
  };
  const mode = resolve('mode', 'off');
  const maxSlots = resolve('maxSlots', 3);
  const autoAdvance = resolve('autoAdvance', true);
  return { mode: mode.value, maxSlots: maxSlots.value, autoAdvance: autoAdvance.value, source: { mode: mode.source, maxSlots: maxSlots.source, autoAdvance: autoAdvance.source } };
}

export function resolveSwarmPolicy(issueId?: string, cli: SwarmPolicyLayer = {}): ResolvedSwarmPolicy {
  const global = loadConfigSync().config.swarm;
  if (!issueId) return resolveSwarmPolicyLayers(global, {}, {}, cli);
  const resolved = resolveProjectFromIssueSync(issueId);
  const project = resolved ? getProjectSync(resolved.projectKey) : undefined;
  const issue = project ? readIssueRecordSync(project, issueId)?.swarm?.policy : undefined;
  return resolveSwarmPolicyLayers(global, project?.swarm, issue, cli);
}

export function resolveAutomaticSwarmPolicy(issueId: string, manual = false, inProgress = false) {
  const policy = resolveSwarmPolicy(issueId);
  return { policy, enabled: manual || (policy.mode !== 'off' && (policy.autoAdvance || !inProgress)) };
}

export function resolveSwarmMaxSlots(issueId: string, configured: number): number {
  return Math.min(Math.max(1, Math.floor(configured)), Math.max(1, Math.floor(resolveSwarmPolicy(issueId).maxSlots)));
}
