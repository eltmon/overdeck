import chalk from 'chalk';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, rmSync, readFileSync, readdirSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { stopAgent, getAgentState } from '../../../lib/agents.js';
import { sessionExists, killSession } from '../../../lib/tmux.js';
import { createFlyProviderFromConfig } from '../../../lib/remote/index.js';
import { loadConfig } from '../../../lib/config.js';
import { loadWorkspaceMetadata, deleteWorkspaceMetadata } from '../../../lib/remote/workspace-metadata.js';

const execAsync = promisify(exec);

interface WipeOptions {
  workspace?: boolean;
  yes?: boolean;
}

export async function wipeCommand(issueId: string, options: WipeOptions): Promise<void> {
  const issueLower = issueId.toLowerCase();
  const cleanupLog: string[] = [];

  console.log(chalk.yellow(`\n🔥 Deep wipe for ${issueId}\n`));

  // Confirmation unless -y flag
  if (!options.yes) {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const confirmed = await new Promise<boolean>((resolve) => {
      rl.question(chalk.red(`This will completely reset all state for ${issueId}. Continue? [y/N] `), (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });

    if (!confirmed) {
      console.log(chalk.gray('Aborted.'));
      return;
    }
  }

  // 1. Kill tmux sessions
  const sessionPatterns = [
    `agent-${issueLower}`,
  ];

  for (const session of sessionPatterns) {
    if (sessionExists(session)) {
      try {
        killSession(session);
        cleanupLog.push(`Killed tmux session: ${session}`);
        console.log(chalk.green(`  ✓ Killed tmux session: ${session}`));
      } catch (e) {
        // Session might already be dead
      }
    }
  }

  // 2. Clean up remote workspace and VM (check workspace metadata FIRST)
  // This ensures we can clean up even if agent state was already deleted
  const workspaceMetadata = loadWorkspaceMetadata(issueLower);
  if (workspaceMetadata?.location === 'remote' && workspaceMetadata?.vmName) {
    const vmName = workspaceMetadata.vmName;
    console.log(chalk.gray(`  → Found remote workspace on VM: ${vmName}`));

    try {
      const fly = createFlyProviderFromConfig(loadConfig().remote);

      // Kill all processes on VM (tmux, claude, etc.)
      try {
        await fly.ssh(vmName, `tmux kill-server 2>/dev/null || true; pkill -f claude 2>/dev/null || true`);
        cleanupLog.push(`Killed processes on VM: ${vmName}`);
        console.log(chalk.green(`  ✓ Killed processes on VM: ${vmName}`));
      } catch (e) {
        // Processes might not exist
      }

      // DELETE the VM (deep wipe = full cleanup)
      try {
        await fly.deleteVm(vmName);
        cleanupLog.push(`Deleted remote VM: ${vmName}`);
        console.log(chalk.green(`  ✓ Deleted remote VM: ${vmName}`));
      } catch (e: any) {
        console.log(chalk.yellow(`  ⚠ Could not delete VM: ${vmName} - ${e.message}`));
      }
    } catch (e: any) {
      console.log(chalk.yellow(`  ⚠ Remote cleanup failed: ${e.message}`));
    }

    // Delete workspace metadata
    if (deleteWorkspaceMetadata(issueLower)) {
      cleanupLog.push(`Deleted workspace metadata`);
      console.log(chalk.green(`  ✓ Deleted workspace metadata`));
    }
  } else {
    // No workspace metadata - still check agent state for remote info (fallback)
    const agentIds = [`agent-${issueLower}`];
    for (const agentId of agentIds) {
      const state = getAgentState(agentId) as any;
      if (state?.location === 'remote' && state?.vmName) {
        console.log(chalk.gray(`  → Found remote agent on VM: ${state.vmName}`));
        try {
          const fly = createFlyProviderFromConfig(loadConfig().remote);

          // Kill processes and delete VM
          try {
            await fly.ssh(state.vmName, `tmux kill-server 2>/dev/null || true; pkill -f claude 2>/dev/null || true`);
            await fly.deleteVm(state.vmName);
            cleanupLog.push(`Deleted remote VM: ${state.vmName}`);
            console.log(chalk.green(`  ✓ Deleted remote VM: ${state.vmName}`));
          } catch (e: any) {
            console.log(chalk.yellow(`  ⚠ Could not delete VM: ${state.vmName} - ${e.message}`));
          }
        } catch (e: any) {
          console.log(chalk.yellow(`  ⚠ Remote cleanup failed: ${e.message}`));
        }
      }
    }
  }

  // 3. Clean up agent state directories
  const agentDirs = [
    join(homedir(), '.panopticon', 'agents', `agent-${issueLower}`),
  ];

  for (const dir of agentDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      cleanupLog.push(`Deleted agent state: ${dir}`);
      console.log(chalk.green(`  ✓ Deleted agent state: ${dir.replace(homedir(), '~')}`));
    }
  }

  // 4. Find project path
  let projectPath: string | undefined;
  const prefix = issueId.split('-')[0].toUpperCase();
  const projectsYamlPath = join(homedir(), '.panopticon', 'projects.yaml');

  if (existsSync(projectsYamlPath)) {
    try {
      const yaml = await import('js-yaml');
      const projectsConfig = yaml.load(readFileSync(projectsYamlPath, 'utf-8')) as any;
      for (const [, config] of Object.entries(projectsConfig.projects || {})) {
        const projConfig = config as any;
        if (projConfig.linear_team?.toUpperCase() === prefix) {
          projectPath = projConfig.path;
          break;
        }
      }
    } catch (e) {
      // Ignore YAML parse errors
    }
  }

  // 5. Delete workspace if requested
  if (options.workspace && projectPath) {
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    if (existsSync(workspacePath)) {
      // Remove git worktrees first
      try {
        const gitDirs = ['api', 'frontend', 'fe', '.'];
        for (const gitDir of gitDirs) {
          const gitPath = join(projectPath, gitDir);
          if (existsSync(join(gitPath, '.git'))) {
            await execAsync(`cd "${gitPath}" && git worktree remove "${workspacePath}" --force 2>/dev/null || true`);
          }
        }
      } catch (e) {
        // Worktree might not exist
      }
      if (existsSync(workspacePath)) {
        rmSync(workspacePath, { recursive: true, force: true });
      }
      cleanupLog.push(`Deleted workspace: ${workspacePath}`);
      console.log(chalk.green(`  ✓ Deleted workspace`));
    }
  }

  // 6. Reset Linear issue (if LINEAR_API_KEY is available)
  const linearKey = process.env.LINEAR_API_KEY;
  if (linearKey) {
    try {
      const { LinearClient } = await import('@linear/sdk');
      const client = new LinearClient({ apiKey: linearKey });
      const issue = await client.issue(issueId);

      if (issue) {
        const team = await issue.team;
        if (team) {
          const states = await team.states();
          const backlogState = states.nodes.find(s => s.type === 'backlog');

          if (backlogState) {
            await issue.update({ stateId: backlogState.id });
            cleanupLog.push('Reset Linear status to Backlog');
            console.log(chalk.green('  ✓ Reset Linear status to Backlog'));
          }

          // Remove labels
          const labels = await issue.labels();
          const labelsToRemove = labels.nodes.filter(l =>
            l.name.toLowerCase() === 'review ready'
          );
          if (labelsToRemove.length > 0) {
            const currentLabelIds = labels.nodes.map(l => l.id);
            const newLabelIds = currentLabelIds.filter(
              lid => !labelsToRemove.some(lr => lr.id === lid)
            );
            await issue.update({ labelIds: newLabelIds });
            cleanupLog.push(`Removed labels: ${labelsToRemove.map(l => l.name).join(', ')}`);
            console.log(chalk.green(`  ✓ Removed labels: ${labelsToRemove.map(l => l.name).join(', ')}`));
          }
        }
      }
    } catch (linearErr: any) {
      console.log(chalk.yellow(`  ⚠ Linear cleanup: ${linearErr.message}`));
    }
  } else {
    console.log(chalk.gray('  - Skipped Linear reset (no LINEAR_API_KEY)'));
  }

  console.log(chalk.green(`\n✓ Deep wipe completed for ${issueId}`));
  if (cleanupLog.length === 0) {
    console.log(chalk.gray('  No state found to clean up.'));
  }
}
