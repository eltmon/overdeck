import { materializeMuseContext } from './muse-context.js';
/** Native Muse Code runtime. Lifecycle operations use the shared delivery and tmux doors. */
import { statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listAgentStates } from '../agents/queries.js';
import { getAgentState, saveAgentStateSync } from '../agents/agent-state.js';
import { deliverAgentMessage } from '../agents/delivery.js';
import { waitForPromptReady } from '../agents/runtime-command.js';
import { isRuntimeAgentAlive } from './runtime-liveness.js';
import { prepareHarnessLaunch } from '../harness-binary.js';
import { generateLauncherScript } from '../launcher-generator.js';
import { resolvePtySupervisorScriptPath } from '../channels/pty-supervisor-locate.js';
import { writePtyToken } from '../pty-token.js';
import { getOverdeckHome } from '../paths.js';
import { getPricing } from '../cost.js';
import { parseMuseSession } from '../cost-parsers/muse-parser.js';
import { museSessionId, resolveMuseSessionPath, resolveMuseSessionPathSync } from './storage/muse.js';
import { getRuntimeBehavior } from './behavior.js';
import { appendSessionIdToHistory } from '../session-history.js';
import { tmuxKillSession, tmuxSessionExists } from './tmux-cli.js';
import { agentPaneExists, closeBackendPane, resolveLaunchBackend } from '../terminal-backends/launch.js';
import type { AgentPaneRef, TerminalBackend } from '../terminal-backends/types.js';
import { launchRuntimePane, runtimeUsesSupervisor } from './runtime-pane-launch.js';
import type { Agent, AgentRuntimeSync, CostBreakdown, Heartbeat, Session, SpawnConfig } from './types.js';

export interface MuseRuntimeOptions {
  /** The backend a spawn launches into. Defaults to the host's (`resolveLaunchBackend`). */
  readonly resolveBackend?: () => Promise<TerminalBackend>;
}

/**
 * Muse readiness on the launch backend. The prompt scan reads the pane; on
 * Herdr a TUI drawn on the alternate screen reads back as empty text, so a
 * healthy agent could time out there. After the bounded scan, a Herdr pane that
 * is still present and has written its durable session log counts as started.
 */
async function waitForMuseStarted(agentId: string, backend: TerminalBackend): Promise<boolean> {
  if (await waitForPromptReady(agentId, 'muse', 60)) return true;
  if (backend.name !== 'herdr') return false;
  return await agentPaneExists(agentId, backend) && (await resolveMuseSessionPath(agentId)) !== null;
}

export class MuseRuntimeSync implements AgentRuntimeSync {
  readonly name = 'muse' as const;
  constructor(private readonly options: MuseRuntimeOptions = {}) {}
  getHarnessBehavior() { return getRuntimeBehavior(this.name); }
  getSessionPath(agentId: string) { return resolveMuseSessionPathSync(agentId); }
  getLastActivity(agentId: string): Date | null {
    const path = this.getSessionPath(agentId);
    try { return path ? statSync(path).mtime : null; } catch { return null; }
  }
  getHeartbeat(agentId: string): Heartbeat | null {
    const timestamp = this.getLastActivity(agentId);
    return timestamp ? { timestamp, agentId, source: 'jsonl', confidence: 'medium' } : null;
  }
  getTokenUsage(agentId: string) {
    const path = this.getSessionPath(agentId);
    return path ? parseMuseSession(path)?.usage ?? null : null;
  }
  getSessionCost(agentId: string): CostBreakdown | null {
    const path = this.getSessionPath(agentId);
    const session = path ? parseMuseSession(path) : null;
    if (!session) return null;
    const pricing = getPricing('custom', session.model);
    if (!pricing) return null;
    return {
      inputCost: session.usage.inputTokens * pricing.inputPer1k / 1000,
      outputCost: session.usage.outputTokens * pricing.outputPer1k / 1000,
      cacheReadCost: (session.usage.cacheReadTokens ?? 0) * (pricing.cacheReadPer1k ?? 0) / 1000,
      cacheWriteCost: 0, totalCost: session.cost, currency: 'USD',
    };
  }
  async sendMessage(agentId: string, message: string): Promise<void> {
    const result = await deliverAgentMessage(agentId, message, 'muse-runtime');
    if (!result.ok) throw new Error(result.failure ?? 'Muse message delivery failed');
  }
  async killAgent(agentId: string): Promise<void> { await tmuxKillSession(agentId); }
  async isRunning(agentId: string): Promise<boolean> { return isRuntimeAgentAlive(agentId, this.name); }
  async spawnAgent(config: SpawnConfig): Promise<Agent> {
    if (!config.model) throw new Error('Muse requires an explicitly configured model');
    const backend = await (this.options.resolveBackend ?? resolveLaunchBackend)();
    const running = backend.name === 'herdr'
      ? await agentPaneExists(config.agentId, backend)
      : await this.isRunning(config.agentId);
    if (running) throw new Error(`Agent ${config.agentId} is already running`);
    const launch = await prepareHarnessLaunch('muse');
    const dir = join(getOverdeckHome(), 'agents', config.agentId);
    await mkdir(dir, { recursive: true });
    // PAN-3936: the supervisor socket is muse's delivery path on both backends.
    const useSupervisor = runtimeUsesSupervisor('muse', backend);
    if (useSupervisor) await writePtyToken(config.agentId);
    const launcher = join(dir, 'launcher.sh');
    const script = generateLauncherScript({
      role: 'work', workingDir: config.workspace, harness: 'muse', museModel: config.model, museEffort: config.effort,
      museContextFile: await materializeMuseContext(config.agentId, config.workspace),
      museResumeSessionId: config.sessionId, overdeckEnv: { agentId: config.agentId },
      extraEnvExports: [launch.pathExport], useSupervisor,
      ...(useSupervisor ? { supervisorScriptPath: resolvePtySupervisorScriptPath() } : {}),
    });
    await writeFile(launcher, script, { mode: 0o700 });
    let pane: AgentPaneRef | null = null;
    try {
      pane = await launchRuntimePane({
        agentId: config.agentId, workspace: config.workspace, harness: 'muse', model: config.model,
        launcherScript: launcher, env: config.env, backend,
        state: getAgentState(config.agentId), saveState: saveAgentStateSync,
      });
      if (!await waitForMuseStarted(config.agentId, backend)) throw new Error('Muse startup timed out');
      const path = await resolveMuseSessionPath(config.agentId);
      if (!path) throw new Error('Muse started without a durable session log');
      appendSessionIdToHistory(config.agentId, museSessionId(path), 'launcher', { harness: 'muse', model: config.model, path });
      if (config.prompt) await this.sendMessage(config.agentId, config.prompt);
      return { id: config.agentId, sessionId: museSessionId(path), runtime: 'muse',
        model: config.model, workspace: config.workspace, startedAt: new Date() };
    } catch (error) {
      await closeBackendPane(pane);
      await this.killAgent(config.agentId);
      throw error;
    }
  }
  listSessions(workspace?: string): Session[] {
    return listAgentStates().filter(state => state.harness === 'muse' && (!workspace || state.workspace === workspace)).flatMap(state => {
      const path = this.getSessionPath(state.id);
      const lastActivity = this.getLastActivity(state.id);
      if (!path || !lastActivity) return [];
      return [{ id: museSessionId(path), agentId: state.id, workspace: state.workspace,
        model: state.model, startedAt: new Date(state.startedAt), lastActivity,
        tokenUsage: this.getTokenUsage(state.id) ?? { inputTokens: 0, outputTokens: 0 } }];
    });
  }
}

export function createMuseRuntime(): MuseRuntimeSync { return new MuseRuntimeSync(); }
