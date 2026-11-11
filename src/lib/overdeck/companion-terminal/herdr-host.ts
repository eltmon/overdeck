/**
 * Herdr implementation of the companion terminal host port (PAN-5122).
 *
 * On a Herdr host the companion is a pane in its own tab of the
 * `conversations` workspace, never an agent (D2): it carries no `agentId`,
 * `role`, `issue`, `harness`, or `model` token, only two dedicated tokens —
 * `companion` (the companion session name) and `companionGeneration` — so
 * `listHerdrAgents`, Herdr `list()`, and the agent directory's pane-only loop
 * never treat it as one.
 *
 * There is no `exec` on Herdr: the pane text is `<quoted argv> ; exit` (D3),
 * so the native client stays a CHILD of the pane's shell while it runs.
 * `paneProcessLiveness` reads the pane as `running` only while a foreground
 * process other than the shell exists; with `exec` the client takes the
 * shell's own pid, so liveness would read `exited` the instant it started and
 * the residue reaper would close it within two sweeps. When the client exits,
 * `exit` ends the shell and the pane closes itself.
 *
 * The owner stamp (D4) comes from a Herdr liveness probe of the owner
 * session: `alive` → `herdr:<paneId>` (Herdr pane ids are never reused, so a
 * respawned owner gets a new stamp); `exited` → `null`; `absent` → the tmux
 * host's stamp, for an owner still running in tmux from before the host moved
 * to Herdr; `indeterminate` → throw, because folding a Herdr outage into
 * `null` would make `open()` reap a live companion and report "not running".
 *
 * Every Herdr lookup here passes a 2 s timeout (D7), so owner teardown can
 * never hold a stop up waiting on this host.
 */
import { Effect } from 'effect';
import { validateSessionName } from '../../tmux.js';
import { getHerdrApiClient, type HerdrApiClient } from '../../terminal-backends/herdr-api.js';
import { herdrBackend, paneProcessLiveness, probeHerdrAgentLiveness, type HerdrLivenessProbe } from '../../terminal-backends/herdr.js';
import { openAgentTab, type SizeTerminal } from '../../terminal-backends/herdr-agent-tab.js';
import { sizeHerdrTerminal } from '../../terminal-backends/herdr-stream.js';
import { CONVERSATIONS_WORKSPACE } from '../../terminal-backends/launch.js';
import { isUnsupported } from '../../terminal-backends/types.js';
import { COMPANION_GENERATION_ENV, createTmuxCompanionHost, shellQuoteArg, type CompanionTerminalHost } from './host.js';

export const COMPANION_NAME_TOKEN = 'companion';
export const COMPANION_GENERATION_TOKEN = 'companionGeneration';
const LOOKUP_TIMEOUT_MS = 2_000;

/** `<quoted argv> ; exit` — never `exec` (D3); throws before any Herdr call on empty argv. */
export function herdrCompanionCommand(argv: readonly string[]): string {
  if (argv.length === 0) throw new Error('Companion terminal argv is empty');
  return `${argv.map(shellQuoteArg).join(' ')} ; exit`;
}

export interface HerdrCompanionHostDeps {
  readonly api: HerdrApiClient;
  readonly probeOwner: (ownerSession: string) => Promise<HerdrLivenessProbe>;
  readonly paneLiveness: (paneId: string) => Promise<'running' | 'exited' | 'indeterminate'>;
  /** The tmux host's owner stamp, for owners still running in tmux (D4 `absent`). */
  readonly tmuxOwnerStamp: (ownerSession: string) => Promise<string | null>;
  /** Herdr workspace id for the companion tab (D5). */
  readonly ensureWorkspace: (cwd: string) => Promise<string>;
  readonly sizeTerminal: SizeTerminal;
}

interface CompanionPane {
  readonly pane_id: string;
  readonly terminal_id: string;
  readonly tokens?: Record<string, string>;
}

async function companionPanes(api: HerdrApiClient, name: string): Promise<CompanionPane[]> {
  const snapshot = await api.call<{ snapshot?: { panes?: CompanionPane[] } }>('session.snapshot', {}, { timeoutMs: LOOKUP_TIMEOUT_MS });
  return (snapshot.snapshot?.panes ?? []).filter((pane) => pane.tokens?.[COMPANION_NAME_TOKEN] === name);
}

async function defaultEnsureWorkspace(cwd: string): Promise<string> {
  const ref = await Effect.runPromise(herdrBackend.workspaceFor(CONVERSATIONS_WORKSPACE, cwd));
  if (isUnsupported(ref)) throw new Error(`herdr cannot host the conversations workspace: ${ref.reason}`);
  return ref.workspaceId;
}

export function createHerdrCompanionHost(overrides: Partial<HerdrCompanionHostDeps> = {}): CompanionTerminalHost {
  const api = overrides.api ?? getHerdrApiClient();
  const deps: HerdrCompanionHostDeps = {
    api,
    probeOwner: overrides.probeOwner ?? ((ownerSession) => probeHerdrAgentLiveness(ownerSession, api)),
    paneLiveness: overrides.paneLiveness ?? ((paneId) => paneProcessLiveness(paneId, api)),
    tmuxOwnerStamp: overrides.tmuxOwnerStamp ?? ((ownerSession) => createTmuxCompanionHost().ownerStamp(ownerSession)),
    ensureWorkspace: overrides.ensureWorkspace ?? defaultEnsureWorkspace,
    sizeTerminal: overrides.sizeTerminal ?? sizeHerdrTerminal,
  };

  return {
    async ownerStamp(ownerSession) {
      const probe = await deps.probeOwner(ownerSession);
      switch (probe.kind) {
        case 'alive':
          return `herdr:${probe.paneId}`;
        case 'exited':
          return null;
        case 'absent':
          return await deps.tmuxOwnerStamp(ownerSession).catch(() => null);
        case 'indeterminate':
          throw new Error(`Herdr did not answer for ${ownerSession}: ${probe.reason}`);
      }
    },

    async readGeneration(companionSession) {
      const panes = await companionPanes(deps.api, companionSession);
      if (panes.length === 0) return undefined;
      if (panes.length > 1) return null;
      const [pane] = panes;
      if ((await deps.paneLiveness(pane.pane_id)) !== 'running') return null;
      const token = pane.tokens?.[COMPANION_GENERATION_TOKEN];
      return token ? token : null;
    },

    async create(companionSession, spec) {
      validateSessionName(companionSession);
      const command = herdrCompanionCommand(spec.argv);
      const workspaceId = await deps.ensureWorkspace(spec.cwd);
      const pane = await openAgentTab(
        deps.api,
        {
          workspaceId,
          cwd: spec.cwd,
          env: { ...spec.env, [COMPANION_GENERATION_ENV]: spec.generation, TERM: 'xterm-256color' },
          label: companionSession,
        },
        deps.sizeTerminal,
      );
      try {
        await deps.api.call('pane.report_metadata', {
          pane_id: pane.pane_id,
          source: 'overdeck',
          tokens: { [COMPANION_NAME_TOKEN]: companionSession, [COMPANION_GENERATION_TOKEN]: spec.generation },
          title: companionSession,
        });
        await deps.api.call('pane.send_input', { pane_id: pane.pane_id, text: command, keys: ['enter'] });
      } catch (error) {
        await deps.api.call('pane.close', { pane_id: pane.pane_id }).catch(() => {});
        throw error;
      }
    },

    async kill(companionSession) {
      const panes = await companionPanes(deps.api, companionSession);
      if (panes.length === 0) return false;
      const results = await Promise.allSettled(panes.map((pane) => deps.api.call('pane.close', { pane_id: pane.pane_id })));
      const succeeded = results.some((result) => result.status === 'fulfilled');
      if (!succeeded) {
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        throw failed?.reason;
      }
      return true;
    },
  };
}

/** Terminal id of the live companion pane named `companionSession`, or null. Never throws. */
export async function findHerdrCompanionTerminalId(
  companionSession: string,
  api: HerdrApiClient = getHerdrApiClient(),
): Promise<string | null> {
  try {
    for (const pane of await companionPanes(api, companionSession)) {
      if ((await paneProcessLiveness(pane.pane_id, api)) === 'running') return pane.terminal_id;
    }
    return null;
  } catch {
    return null;
  }
}
