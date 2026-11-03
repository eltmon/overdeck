/**
 * Linked work agents on Fly machines (PAN-4734 WI-7, D-1, D-2).
 *
 * `pan start <id> --remote` posts to `POST /api/remote/work-agents`, which
 * calls `startFlyWorkAgent()`. It provisions a Fly machine with the issue's
 * project (`addFlyMachine`, PAN-4652), adds the issue's git worktree on it
 * (`ensureFlyWorkspace`, D-3), and starts the work agent as a conversation on
 * the VM's own server through the link. Home sees the conversation live as a
 * linked conversation, so the transcript is visible while the agent works.
 *
 * The agent keeps a `remote-state.json` under `agent-<issue>` with the linked
 * fields (FR-7). The reap, `pan tell`, `pan kill` and the output view read it
 * and address the conversation's tmux session on the VM (D-5). It is saved
 * `starting` before any VM exists and reaches `running` only after the
 * conversation and the push daemon started.
 *
 * Every refusal happens before a VM exists (FR-4). A failure after the
 * machine exists unlinks it, which destroys the machine and forgets its record
 * through the PAN-4652 unlink hook, and saves the state `error` (FR-13).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ensureFlyWorkspace } from '../../../lib/anywhere/fly/project.js';
import { getLink } from '../../../lib/anywhere/link-store.js';
import { determineModel } from '../../../lib/agents/provider-env.js';
import { isOperatorStartedBy } from '../../../lib/agents/provenance.js';
import { InvalidEffortError, resolveEffort } from '../../../lib/agents/resolve-effort.js';
import { buildWorkAgentPrompt } from '../../../lib/cloister/work-agent-prompt.js';
import { loadConfig, type RemoteConfig } from '../../../lib/config.js';
import { type AcceptAutoSpawnConsent, withAutoSpawnConsentClaim } from '../../../lib/planning/auto-spawn-consent.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { getProviderForModel, UnknownModelError } from '../../../lib/providers.js';
import type { FlyProvider } from '../../../lib/remote/fly-provider.js';
import { createFlyProviderFromConfig } from '../../../lib/remote/index.js';
import {
  installPushDaemon,
  loadRemoteAgentState,
  type RemoteAgentState,
  saveRemoteAgentState,
  writeRemoteFile,
} from '../../../lib/remote/remote-agents.js';
import { REMOTE_PAN_DIR } from '../../../lib/remote/remote-tmux.js';
import { addFlyMachine, type FlyConversation, startFlyConversation } from './fly-machine-service.js';
import { currentLinkedConversationsSync } from './linked-conversations-sync.js';

/** The tmux socket of a Fly machine's server: it runs with the default OVERDECK_HOME (D-6). */
const VM_TMUX_SOCKET = 'overdeck';
/** A `starting` state this old is crashed provisioning and is overwritten (FR-4). */
const STALE_STARTING_MS = 30 * 60_000;
/** A longer prompt goes to a file on the VM and the message points at it (FR-6). */
const MAX_PROMPT_MESSAGE_CHARS = 50_000;

export type FlyWorkAgentErrorCode = 'bad-request' | 'project-unknown' | 'harness-unsupported' | 'already-running';

const FLY_WORK_AGENT_ERROR_STATUS: Record<FlyWorkAgentErrorCode, number> = {
  'bad-request': 400,
  'project-unknown': 404,
  'harness-unsupported': 400,
  'already-running': 409,
};

export class FlyWorkAgentError extends Error {
  readonly status: number;
  constructor(readonly code: FlyWorkAgentErrorCode, message: string) {
    super(message);
    this.name = 'FlyWorkAgentError';
    this.status = FLY_WORK_AGENT_ERROR_STATUS[code];
  }
}

export interface StartFlyWorkAgentInput {
  issueId: string;
  model?: string;
  effort?: string;
  startedBy: string;
  autoSpawnConsentRequired?: boolean;
}

export interface StartFlyWorkAgentResult {
  issueId: string;
  agentId: string;
  environmentId: string;
  name: string;
  path: string;
  /** The Fly machine's label (`fly-<machineId>`). */
  machine: string;
}

type RemoteFileProvider = Pick<FlyProvider, 'ssh' | 'copySkillsToVm'>;

export interface FlyWorkAgentDeps {
  notifyLinksChanged: () => void;
  /** Unlink the machine: destroys it and forgets its record. A status other than 200 is a failure. */
  unlink: (linkId: string) => Promise<{ status: number }>;
  loadConfig: () => Promise<{ remote?: RemoteConfig }>;
  resolveProject: (issueId: string) => { projectKey: string; projectPath: string } | null;
  determineModel: (model: string | undefined) => string;
  resolveEffort: (input: { explicit?: string; issueId: string; model: string }) => { effort: string; warning?: string };
  providerName: (model: string) => string;
  addFlyMachine: typeof addFlyMachine;
  ensureWorkspace: (machine: { appName: string; machineId: string }, projectKey: string, issueId: string) => Promise<string>;
  startConversation: (link: { environmentId: string }, input: Parameters<typeof startFlyConversation>[1]) => Promise<FlyConversation>;
  createProvider: (remote: RemoteConfig | undefined) => RemoteFileProvider;
  writeRemoteFile: (provider: RemoteFileProvider, vmName: string, path: string, content: string) => Promise<void>;
  installPushDaemon: (provider: RemoteFileProvider, vmName: string, issueId: string, workdir: string) => Promise<void>;
  loadState: (agentId: string) => RemoteAgentState | null;
  saveState: (state: RemoteAgentState) => void;
  buildPrompt: (issueId: string, workdir: string) => Promise<string>;
  readHomeFile: (path: string) => string | null;
  withConsent: typeof withAutoSpawnConsentClaim;
  /** List the new conversation at home now instead of on the next sync. */
  refreshLinked: (linkId: string) => Promise<void>;
  now: () => Date;
  log: (message: string) => void;
}

const defaultDeps: Omit<FlyWorkAgentDeps, 'notifyLinksChanged' | 'unlink'> = {
  loadConfig,
  resolveProject: (issueId) => resolveProjectFromIssueSync(issueId),
  determineModel: (model) => determineModel({ model, role: 'work' }),
  resolveEffort: ({ explicit, issueId, model }) => resolveEffort({ explicit, role: 'work', issueId, model, harness: 'claude-code' }),
  providerName: (model) => getProviderForModel(model).name,
  addFlyMachine,
  ensureWorkspace: (machine, projectKey, issueId) => ensureFlyWorkspace(machine, projectKey, issueId),
  startConversation: (link, input) => startFlyConversation(link, input),
  createProvider: (remote) => createFlyProviderFromConfig(remote, 'ephemeral'),
  writeRemoteFile: (provider, vmName, path, content) => writeRemoteFile(provider as FlyProvider, vmName, path, content),
  installPushDaemon: (provider, vmName, issueId, workdir) => installPushDaemon(provider as FlyProvider, vmName, issueId, workdir),
  loadState: loadRemoteAgentState,
  saveState: saveRemoteAgentState,
  buildPrompt: (issueId, workdir) => buildWorkAgentPrompt({ issueId, env: 'REMOTE', workspacePath: workdir, skipDynamicContext: true }),
  readHomeFile: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
  withConsent: withAutoSpawnConsentClaim,
  refreshLinked: async (linkId) => {
    const link = await getLink(linkId);
    if (link) await currentLinkedConversationsSync()?.onConnect(link);
  },
  now: () => new Date(),
  log: (message) => console.warn(`[fly-work] ${message}`),
};

/** FR-4: refuse a live or recently started agent; a `starting` state 30 minutes old is crashed provisioning. */
function refuseRunning(state: RemoteAgentState | null, issueId: string, now: Date): void {
  if (!state) return;
  const fresh = state.status === 'starting' && now.getTime() - Date.parse(state.startedAt) < STALE_STARTING_MS;
  if (state.status !== 'running' && !fresh) return;
  const where = state.conversationName && state.environmentId
    ? ` at /conv/@${state.environmentId}/${state.conversationName}`
    : state.vmName ? ` on ${state.vmName}` : '';
  throw new FlyWorkAgentError('already-running', `A work agent for ${issueId} is already ${state.status}${where}. Message it with pan tell, or stop it with pan kill.`);
}

/** D-10: a Fly work agent is Claude Code, so the model must be an Anthropic one. */
function refuseNonAnthropic(model: string, deps: Pick<FlyWorkAgentDeps, 'providerName'>): void {
  let provider: string;
  try {
    provider = deps.providerName(model);
  } catch (error) {
    if (!(error instanceof UnknownModelError)) throw error;
    throw new FlyWorkAgentError('harness-unsupported', `${error.message} Fly work agents run Claude Code: pass --model with an Anthropic model id.`);
  }
  if (provider !== 'anthropic') {
    throw new FlyWorkAgentError('harness-unsupported', `Fly work agents run Claude Code, which cannot run ${model}. Pass --model with an Anthropic model id.`);
  }
}

export async function startFlyWorkAgent(
  input: StartFlyWorkAgentInput,
  overrides: Partial<FlyWorkAgentDeps> & Pick<FlyWorkAgentDeps, 'notifyLinksChanged' | 'unlink'>,
): Promise<StartFlyWorkAgentResult> {
  const deps: FlyWorkAgentDeps = { ...defaultDeps, ...overrides };
  const issueId = input.issueId.toUpperCase();
  const agentId = `agent-${issueId.toLowerCase()}`;
  const project = deps.resolveProject(issueId);
  if (!project) throw new FlyWorkAgentError('project-unknown', `No registered project has the issue prefix of ${issueId}.`);
  refuseRunning(deps.loadState(agentId), issueId, deps.now());

  const launch = (model: string | undefined, accept?: AcceptAutoSpawnConsent) =>
    launchWorkAgent({ ...input, issueId, model }, agentId, project, deps, accept);
  // D-11: the same consent rule as a legacy remote spawn; an operator start never claims.
  const state = isOperatorStartedBy(input.startedBy) || input.autoSpawnConsentRequired !== true
    ? await launch(input.model)
    : await deps.withConsent(
      issueId,
      (accept, claim) => launch(claim.workModel ?? input.model, accept),
      { isAccepted: (result) => result.status === 'running' },
    );

  return {
    issueId,
    agentId,
    environmentId: state.environmentId!,
    name: state.conversationName!,
    path: `/conv/@${state.environmentId}/${state.conversationName}`,
    machine: `fly-${state.flyMachineId}`,
  };
}

async function launchWorkAgent(
  input: StartFlyWorkAgentInput,
  agentId: string,
  project: { projectKey: string; projectPath: string },
  deps: FlyWorkAgentDeps,
  acceptConsent: AcceptAutoSpawnConsent | undefined,
): Promise<RemoteAgentState> {
  const { issueId } = input;
  const issueLower = issueId.toLowerCase();
  const model = deps.determineModel(input.model);
  refuseNonAnthropic(model, deps);
  let effort: string;
  try {
    const resolved = deps.resolveEffort({ explicit: input.effort, issueId, model });
    if (resolved.warning) deps.log(resolved.warning);
    effort = resolved.effort;
  } catch (error) {
    if (error instanceof InvalidEffortError) throw new FlyWorkAgentError('bad-request', error.message);
    throw error;
  }

  // FR-7: saved before any VM exists, so a crash mid-provisioning is visible and refuses a second start.
  let state: RemoteAgentState = {
    id: agentId,
    issueId,
    vmName: '',
    model,
    status: 'starting',
    startedAt: deps.now().toISOString(),
    location: 'remote',
    startedBy: input.startedBy,
    tier: 'ephemeral',
    linked: true,
    projectKey: project.projectKey,
    tmuxSocket: VM_TMUX_SOCKET,
  };
  const save = (patch: Partial<RemoteAgentState>): void => {
    state = { ...state, ...patch };
    deps.saveState(state);
  };
  save({});

  let linkId: string | null = null;
  try {
    const { record } = await deps.addFlyMachine({ projectKey: project.projectKey, harness: 'claude-code' }, { notifyLinksChanged: deps.notifyLinksChanged });
    linkId = record.linkId;
    save({ vmName: record.machineName, environmentId: record.environmentId ?? undefined, linkId: record.linkId ?? undefined, flyMachineId: record.machineId });
    if (!record.environmentId || !record.linkId) throw new Error(`Fly machine ${record.label} has no link after provisioning.`);

    const workdir = await deps.ensureWorkspace(record, project.projectKey, issueId);
    save({ workdir });

    const fly = deps.createProvider((await deps.loadConfig()).remote);
    const homeContinue = deps.readHomeFile(join(project.projectPath, 'workspaces', `feature-${issueLower}`, '.overdeck', 'continue.json'));
    if (homeContinue !== null) await deps.writeRemoteFile(fly, record.machineName, `${workdir}/.overdeck/continue.json`, homeContinue);
    await fly.copySkillsToVm(record.machineName);

    const prompt = await deps.buildPrompt(issueId, workdir);
    let message = prompt;
    if (prompt.length > MAX_PROMPT_MESSAGE_CHARS) {
      const promptPath = `${REMOTE_PAN_DIR}/prompts/${agentId}.md`;
      await deps.writeRemoteFile(fly, record.machineName, promptPath, prompt);
      message = `Read ${promptPath} and follow it exactly. It is your work-agent prompt for ${issueId}.`;
    }

    const conversation = await deps.startConversation(
      { environmentId: record.environmentId },
      { message, projectKey: project.projectKey, cwd: workdir, issueId, harness: 'claude-code', model, effort },
    );
    save({ conversationName: conversation.name, tmuxSession: conversation.tmuxSession });

    await deps.installPushDaemon(fly, record.machineName, issueId, workdir);
    await acceptConsent?.();
    save({ status: 'running' });
  } catch (error) {
    if (linkId !== null) await unlinkQuietly(linkId, deps);
    save({ status: 'error' });
    throw error;
  }

  // The conversation lists at home on the next sync anyway; a refresh failure only delays it.
  await deps.refreshLinked(linkId!).catch((error: unknown) => deps.log(`Could not refresh linked conversations: ${(error as Error).message}`));
  return state;
}

/** FR-13: an unlink failure is logged and never replaces the original error; the sweep is the backstop. */
async function unlinkQuietly(linkId: string, deps: Pick<FlyWorkAgentDeps, 'unlink' | 'log'>): Promise<void> {
  try {
    const response = await deps.unlink(linkId);
    if (response.status !== 200) deps.log(`Could not unlink Fly machine link ${linkId} (status ${response.status}); the sweep will remove it.`);
  } catch (error) {
    deps.log(`Could not unlink Fly machine link ${linkId}: ${(error as Error).message}; the sweep will remove it.`);
  }
}
