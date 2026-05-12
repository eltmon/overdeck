/**
 * Claude Code Runtime Adapter
 *
 * Adapter for Claude Code (claude-code CLI from Anthropic)
 */

import { existsSync, mkdirSync, readdirSync, symlinkSync, unlinkSync, lstatSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type {
  RuntimeAdapter,
  RuntimeConfig,
  RuntimeType,
  AgentSpawnOptions,
  AgentStatus,
  AgentMessage,
} from './interface.js';
import { CLAUDE_FEATURES } from './interface.js';
import { generateLauncherScript } from '../launcher-generator.js';
import { getClaudePermissionFlags } from '../claude-permissions.js';

const CLAUDE_DIR = join(homedir(), '.claude');

export function createClaudeAdapter(): RuntimeAdapter {
  const config: RuntimeConfig = {
    type: 'claude',
    name: 'Claude Code',
    configDir: CLAUDE_DIR,
    skillsDir: join(CLAUDE_DIR, 'skills'),
    commandsDir: join(CLAUDE_DIR, 'commands'),
    executable: 'claude',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    features: CLAUDE_FEATURES,
  };

  return {
    type: 'claude' as RuntimeType,
    config,

    async isAvailable(): Promise<boolean> {
      try {
        const { execa } = await import('execa');
        const result = await execa('which', ['claude']);
        console.log(`[claude-invoke] purpose=runtime-check | model=n/a | source=runtime/claude.ts:isAvailable | command="which claude" | available=${result.exitCode === 0}`);
        return result.exitCode === 0;
      } catch {
        console.log(`[claude-invoke] purpose=runtime-check | model=n/a | source=runtime/claude.ts:isAvailable | command="which claude" | available=false`);
        return false;
      }
    },

    async getVersion(): Promise<string | null> {
      try {
        const { execa } = await import('execa');
        const result = await execa('claude', ['--version']);
        const version = result.stdout.trim();
        console.log(`[claude-invoke] purpose=runtime-check | model=n/a | source=runtime/claude.ts:getVersion | command="claude --version" | version="${version}"`);
        return version;
      } catch {
        console.log(`[claude-invoke] purpose=runtime-check | model=n/a | source=runtime/claude.ts:getVersion | command="claude --version" | version=null`);
        return null;
      }
    },

    async initialize(): Promise<void> {
      mkdirSync(config.skillsDir, { recursive: true });
      if (config.commandsDir) {
        mkdirSync(config.commandsDir, { recursive: true });
      }
    },

    async spawnAgent(id: string, options: AgentSpawnOptions): Promise<boolean> {
      try {
        const { execa } = await import('execa');
        const { mkdirSync, writeFileSync } = await import('fs');
        const { join } = await import('path');
        const { homedir } = await import('os');

        // Build the command args - no --print, use interactive mode for long-running agents
        const args: string[] = [];

        if (options.model) {
          args.push('--model', options.model);
        }

        // Add permission flags for autonomous agents (auto by default; bypass via config/--yolo)
        args.push(...getClaudePermissionFlags());

        // Spawn in tmux session using a launcher script (safer for prompts with special chars)
        const sessionName = `agent-${id}`;
        const agentDir = join(homedir(), '.panopticon', 'agents', sessionName);
        mkdirSync(agentDir, { recursive: true });

        // Write prompt to file
        const promptFile = join(agentDir, 'init-prompt.txt');
        writeFileSync(promptFile, options.prompt);

        // Create launcher script
        const launcherScript = join(agentDir, 'launcher.sh');
        writeFileSync(
          launcherScript,
          generateLauncherScript({
            role: 'work',
            workingDir: options.workingDir,
            setTerminalEnv: true,
            promptFile,
            baseCommand: 'claude',
            extraArgs: args.length > 0 ? args.join(' ') : undefined,
          }),
          { mode: 0o755 },
        );

        await execa('tmux', [
          'new-session',
          '-d',
          '-s', sessionName,
          'bash', launcherScript,
        ]);

        // Resize window for Claude TUI
        try {
          await execa('tmux', ['resize-window', '-t', sessionName, '-x', '200', '-y', '50'], { reject: false });
        } catch {
          // Ignore resize errors
        }

        return true;
      } catch (error) {
        console.error('Failed to spawn Claude agent:', error);
        return false;
      }
    },

    async sendMessage(id: string, message: AgentMessage): Promise<boolean> {
      try {
        const { execa } = await import('execa');
        const sessionName = `agent-${id}`;

        await execa('tmux', ['send-keys', '-t', sessionName, message.content]);
        await execa('tmux', ['send-keys', '-t', sessionName, 'Enter']);

        return true;
      } catch {
        return false;
      }
    },

    async getAgentStatus(id: string): Promise<AgentStatus | null> {
      try {
        const { execa } = await import('execa');
        const sessionName = `agent-${id}`;

        // Check if session exists
        const result = await execa('tmux', ['has-session', '-t', sessionName], {
          reject: false,
        });

        if (result.exitCode !== 0) {
          return null;
        }

        return {
          id,
          runtime: 'claude',
          status: 'running',
          startedAt: new Date().toISOString(), // Would need to track this
        };
      } catch {
        return null;
      }
    },

    async stopAgent(id: string): Promise<boolean> {
      try {
        const { execa } = await import('execa');
        const sessionName = `agent-${id}`;

        await execa('tmux', ['kill-session', '-t', sessionName]);
        return true;
      } catch {
        return false;
      }
    },

    async listAgents(): Promise<AgentStatus[]> {
      try {
        const { execa } = await import('execa');

        const result = await execa('tmux', ['list-sessions', '-F', '#{session_name}'], {
          reject: false,
        });

        if (result.exitCode !== 0 || !result.stdout) {
          return [];
        }

        const sessions = result.stdout.split('\n').filter(s => s.startsWith('agent-'));

        return sessions.map(session => ({
          id: session.replace('agent-', ''),
          runtime: 'claude' as RuntimeType,
          status: 'running' as const,
          startedAt: new Date().toISOString(),
        }));
      } catch {
        return [];
      }
    },

    async syncSkills(sourceDir: string, force?: boolean): Promise<number> {
      if (!existsSync(sourceDir)) return 0;

      mkdirSync(config.skillsDir, { recursive: true });

      let synced = 0;
      const skills = readdirSync(sourceDir, { withFileTypes: true })
        .filter(d => d.isDirectory());

      for (const skill of skills) {
        const sourcePath = join(sourceDir, skill.name);
        const targetPath = join(config.skillsDir, skill.name);

        // Check if SKILL.md exists
        if (!existsSync(join(sourcePath, 'SKILL.md'))) {
          continue;
        }

        // Skip if target exists and not forcing
        if (existsSync(targetPath)) {
          if (!force) {
            // Check if it's a symlink to us
            try {
              const stats = lstatSync(targetPath);
              if (!stats.isSymbolicLink()) {
                // It's a real directory, skip
                continue;
              }
            } catch {
              continue;
            }
          }
          // Remove existing
          try {
            unlinkSync(targetPath);
          } catch {
            continue;
          }
        }

        // Create symlink
        try {
          symlinkSync(sourcePath, targetPath);
          synced++;
        } catch {
          // Symlink failed
        }
      }

      return synced;
    },

    async syncCommands(sourceDir: string, force?: boolean): Promise<number> {
      if (!config.commandsDir || !existsSync(sourceDir)) return 0;

      mkdirSync(config.commandsDir, { recursive: true });

      let synced = 0;
      const commands = readdirSync(sourceDir, { withFileTypes: true })
        .filter(d => d.isDirectory());

      for (const command of commands) {
        const sourcePath = join(sourceDir, command.name);
        const targetPath = join(config.commandsDir, command.name);

        if (existsSync(targetPath) && !force) {
          continue;
        }

        if (existsSync(targetPath)) {
          try {
            unlinkSync(targetPath);
          } catch {
            continue;
          }
        }

        try {
          symlinkSync(sourcePath, targetPath);
          synced++;
        } catch {
          // Symlink failed
        }
      }

      return synced;
    },

    getSkillsDir(): string {
      return config.skillsDir;
    },

    getCommandsDir(): string {
      return config.commandsDir || '';
    },
  };
}
