import chalk from 'chalk';
import {
  readAgentState,
  writeAgentState,
  updateCheckpoint,
  appendSummary,
  logHistory,
  searchHistory,
  getRecentHistory,
  materializeOutput,
  listMaterialized,
  readMaterialized,
  estimateTokens,
  AgentStateContext,
} from '../../lib/context.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { AGENTS_DIR } from '../../lib/paths.js';

interface ContextOptions {
  json?: boolean;
}

export async function contextCommand(
  action: string,
  arg1?: string,
  arg2?: string,
  options: ContextOptions = {}
): Promise<void> {
  // Get agent ID from environment or argument
  const agentId = process.env.PANOPTICON_AGENT_ID || arg1 || 'default';

  switch (action) {
    case 'state': {
      // Show or update STATE.md
      const state = readAgentState(agentId);

      if (options.json) {
        console.log(JSON.stringify(state, null, 2));
        return;
      }

      if (!state) {
        console.log(chalk.dim('No state found for agent.'));
        console.log(chalk.dim('Initialize with: pan show --context init <agent-id> <issue-id>'));
        return;
      }

      console.log(chalk.bold(`\nAgent State: ${state.issueId}\n`));
      console.log(`Status: ${chalk.cyan(state.status)}`);
      console.log(`Last Activity: ${chalk.dim(state.lastActivity)}`);

      if (state.lastCheckpoint) {
        console.log('');
        console.log(chalk.bold('Session Continuity:'));
        console.log(`  Checkpoint: ${chalk.yellow(state.lastCheckpoint)}`);
        if (state.resumePoint) {
          console.log(`  Resume: ${chalk.green(state.resumePoint)}`);
        }
      }

      if (state.contextRefs.workspace || state.contextRefs.prd) {
        console.log('');
        console.log(chalk.bold('Context References:'));
        if (state.contextRefs.workspace) {
          console.log(`  Workspace: ${chalk.dim(state.contextRefs.workspace)}`);
        }
        if (state.contextRefs.prd) {
          console.log(`  PRD: ${chalk.dim(state.contextRefs.prd)}`);
        }
        if (state.contextRefs.beads) {
          console.log(`  Beads: ${chalk.dim(state.contextRefs.beads)}`);
        }
      }
      console.log('');
      break;
    }

    case 'init': {
      // Initialize STATE.md for an agent
      const issueId = arg2 || arg1 || 'UNKNOWN';
      const targetAgent = arg2 ? arg1 : agentId;

      const state: AgentStateContext = {
        issueId: issueId.toUpperCase(),
        status: 'In Progress',
        lastActivity: new Date().toISOString(),
        contextRefs: {},
      };

      writeAgentState(targetAgent!, state);
      logHistory(targetAgent!, 'context:init', { issueId });

      console.log(chalk.green(`✓ Initialized state for ${targetAgent}`));
      break;
    }

    case 'checkpoint': {
      // Update checkpoint
      const checkpoint = arg1;
      const resume = arg2;

      if (!checkpoint) {
        console.log(chalk.red('Checkpoint message required'));
        console.log(chalk.dim('Usage: pan show --context checkpoint "message" ["resume point"]'));
        return;
      }

      updateCheckpoint(agentId, checkpoint, resume);
      logHistory(agentId, 'context:checkpoint', { checkpoint, resume });

      console.log(chalk.green(`✓ Checkpoint saved: "${checkpoint}"`));
      if (resume) {
        console.log(chalk.dim(`  Resume point: "${resume}"`));
      }
      break;
    }

    case 'summary': {
      // Add a work summary
      const title = arg1 || 'Work Session';

      // Read summary from stdin or prompt
      const summary = {
        title,
        completedAt: new Date().toISOString(),
        whatWasDone: ['Completed assigned work'],
      };

      appendSummary(agentId, summary);
      logHistory(agentId, 'context:summary', { title });

      console.log(chalk.green(`✓ Summary added: "${title}"`));
      break;
    }

    case 'history': {
      // Search or show history
      const pattern = arg1;

      if (pattern) {
        const results = searchHistory(agentId, pattern);
        if (results.length === 0) {
          console.log(chalk.dim('No matches found.'));
          return;
        }

        console.log(chalk.bold(`\nHistory matches for "${pattern}":\n`));
        for (const line of results.slice(0, 50)) {
          console.log(line);
        }
      } else {
        const recent = getRecentHistory(agentId, 20);
        if (recent.length === 0) {
          console.log(chalk.dim('No history yet.'));
          return;
        }

        console.log(chalk.bold('\nRecent History:\n'));
        for (const line of recent) {
          console.log(line);
        }
      }
      console.log('');
      break;
    }

    case 'materialize': {
      // List or read materialized outputs
      const filepath = arg1;

      if (filepath && existsSync(filepath)) {
        const content = readMaterialized(filepath);
        if (content) {
          console.log(content);
        }
        return;
      }

      const outputs = listMaterialized(agentId);
      if (outputs.length === 0) {
        console.log(chalk.dim('No materialized outputs.'));
        return;
      }

      console.log(chalk.bold('\nMaterialized Outputs:\n'));
      for (const out of outputs) {
        const date = new Date(out.timestamp).toLocaleString();
        console.log(`  ${chalk.cyan(out.tool)} ${chalk.dim(date)}`);
        console.log(`    ${chalk.dim(out.file)}`);
      }
      console.log('');
      break;
    }

    case 'tokens': {
      // Estimate tokens for a file or text
      const target = arg1;

      if (!target) {
        console.log(chalk.dim('Usage: pan show --context tokens <file-or-text>'));
        return;
      }

      let text = target;
      if (existsSync(target)) {
        text = readFileSync(target, 'utf-8');
      }

      const tokens = estimateTokens(text);
      console.log(`Estimated tokens: ${chalk.cyan(tokens.toLocaleString())}`);
      break;
    }

    default:
      console.log(chalk.bold('Context Commands:'));
      console.log('');
      console.log(`  ${chalk.cyan('pan show --context state [agent-id]')}     - Show current state`);
      console.log(`  ${chalk.cyan('pan show --context init <agent> <issue>')} - Initialize state`);
      console.log(`  ${chalk.cyan('pan show --context checkpoint "msg"')}     - Save checkpoint`);
      console.log(`  ${chalk.cyan('pan show --context summary [title]')}      - Add work summary`);
      console.log(`  ${chalk.cyan('pan show --context history [pattern]')}    - Search history`);
      console.log(`  ${chalk.cyan('pan show --context materialize [file]')}   - List/read outputs`);
      console.log(`  ${chalk.cyan('pan show --context tokens <file>')}        - Estimate token count`);
      console.log('');
  }
}
