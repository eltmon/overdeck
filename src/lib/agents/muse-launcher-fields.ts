/**
 * Muse launcher fields for `buildAgentLaunchConfig` (spawn-prep.ts): the model,
 * the resolved effort, the materialized role context file and, on a resume, the
 * saved Muse session id. Extracted from spawn-prep.ts (PAN-4932) to keep that
 * file under its file-size ceiling; the behavior is unchanged.
 */
import type { RoleEffort } from '../config-yaml.js';
import { materializeMuseContext } from '../runtimes/muse-context.js';
import { museSessionId, resolveMuseSessionPath } from '../runtimes/storage/muse.js';
import type { Role } from './role.js';
import { resolveEffort } from './resolve-effort.js';

export async function getMuseLauncherFields(opts: {
  agentId: string;
  model: string;
  workspace: string;
  role: Role;
  effort?: RoleEffort;
  resume: boolean;
  definitionPath: string;
}) {
  const saved = opts.resume ? await resolveMuseSessionPath(opts.agentId) : null;
  return {
    harness: 'muse' as const,
    museModel: opts.model,
    museEffort: resolveEffort({ explicit: opts.effort, role: opts.role, model: opts.model, harness: 'muse' }).effort,
    museContextFile: await materializeMuseContext(opts.agentId, opts.workspace, opts.definitionPath),
    museResumeSessionId: saved ? museSessionId(saved) : undefined,
  };
}
