import { materializeMuseContext } from './muse-context.js';
/** Native Muse Code runtime. Lifecycle operations use the shared delivery and tmux doors. */
import { statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listAgentStates } from '../agents/queries.js';
import { deliverAgentMessage } from '../agents/delivery.js';
import { waitForPromptReady } from '../agents/runtime-command.js';
import { prepareHarnessLaunch } from '../harness-binary.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { resolvePtySupervisorScriptPath } from '../channels/pty-supervisor-locate.js';
import { writePtyToken } from '../pty-token.js';
import { getOverdeckHome } from '../paths.js';
import { getPricingSync } from '../cost.js';
import { parseMuseSessionSync } from '../cost-parsers/muse-parser.js';
import { museSessionId, resolveMuseSessionPath, resolveMuseSessionPathSync } from './muse-session.js';
import { getRuntimeBehavior } from './behavior.js';
import { tmuxCreateSession, tmuxKillSession, tmuxSessionExists } from './tmux-cli.js';
import type { Agent, AgentRuntimeSync, CostBreakdown, Heartbeat, Session, SpawnConfig } from './types.js';

export class MuseRuntimeSync implements AgentRuntimeSync {
  readonly name = 'muse' as const;
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
    return path ? parseMuseSessionSync(path)?.usage ?? null : null;
  }
  getSessionCost(agentId: string): CostBreakdown | null {
    const path = this.getSessionPath(agentId);
    const session = path ? parseMuseSessionSync(path) : null;
    if (!session) return null;
    const pricing = getPricingSync('custom', session.model);
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
  async isRunning(agentId: string): Promise<boolean> { return tmuxSessionExists(agentId); }
  async spawnAgent(config: SpawnConfig): Promise<Agent> {
    if (!config.model) throw new Error('Muse requires an explicitly configured model');
    if (await this.isRunning(config.agentId)) throw new Error(`Agent ${config.agentId} is already running`);
    const launch = await prepareHarnessLaunch('muse');
    const dir = join(getOverdeckHome(), 'agents', config.agentId);
    await mkdir(dir, { recursive: true });
    await writePtyToken(config.agentId);
    const launcher = join(dir, 'launcher.sh');
    const script = generateLauncherScriptSync({
      role: 'work', workingDir: config.workspace, harness: 'muse', museModel: config.model,
      museContextFile: await materializeMuseContext(config.agentId, config.workspace),
      museResumeSessionId: config.sessionId, overdeckEnv: { agentId: config.agentId },
      extraEnvExports: [launch.pathExport], useSupervisor: true,
      supervisorScriptPath: resolvePtySupervisorScriptPath(),
    });
    await writeFile(launcher, script, { mode: 0o700 });
    await tmuxCreateSession(config.agentId, config.workspace, `bash '${launcher.replace(/'/g, "'\\''")}'`, config.env);
    try {
      if (!await waitForPromptReady(config.agentId, 'muse', 60)) throw new Error('Muse startup timed out');
      const path = await resolveMuseSessionPath(config.agentId);
      if (!path) throw new Error('Muse started without a durable session log');
      if (config.prompt) await this.sendMessage(config.agentId, config.prompt);
      return { id: config.agentId, sessionId: museSessionId(path), runtime: 'muse',
        model: config.model, workspace: config.workspace, startedAt: new Date() };
    } catch (error) {
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

export function createMuseRuntimeSync(): MuseRuntimeSync { return new MuseRuntimeSync(); }
