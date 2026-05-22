import chalk from 'chalk';
import {
  appendSummarySync,
  logHistorySync,
  searchHistorySync,
  getRecentHistorySync,
  materializeOutputSync,
  listMaterializedSync,
  readMaterializedSync,
  estimateTokensSync,
} from '../../lib/context.js';
import { readFileSync, existsSync } from 'fs';

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
    case 'summary': {
      // Add a work summary
      const title = arg1 || 'Work Session';

      // Read summary from stdin or prompt
      const summary = {
        title,
        completedAt: new Date().toISOString(),
        whatWasDone: ['Completed assigned work'],
      };

      appendSummarySync(agentId, summary);
      logHistorySync(agentId, 'context:summary', { title });

      console.log(chalk.green(`✓ Summary added: "${title}"`));
      break;
    }

    case 'history': {
      // Search or show history
      const pattern = arg1;

      if (pattern) {
        const results = searchHistorySync(agentId, pattern);
        if (results.length === 0) {
          console.log(chalk.dim('No matches found.'));
          return;
        }

        console.log(chalk.bold(`\nHistory matches for "${pattern}":\n`));
        for (const line of results.slice(0, 50)) {
          console.log(line);
        }
      } else {
        const recent = getRecentHistorySync(agentId, 20);
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
        const content = readMaterializedSync(filepath);
        if (content) {
          console.log(content);
        }
        return;
      }

      const outputs = listMaterializedSync(agentId);
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

      const tokens = estimateTokensSync(text);
      console.log(`Estimated tokens: ${chalk.cyan(tokens.toLocaleString())}`);
      break;
    }

    default:
      // Suppress unused-arg lint hint for arg2 / agentId / options.json
      void arg2;
      void agentId;
      void options.json;
      console.log(chalk.bold('Context Commands:'));
      console.log('');
      console.log(`  ${chalk.cyan('pan show --context summary [title]')}      - Add work summary`);
      console.log(`  ${chalk.cyan('pan show --context history [pattern]')}    - Search history`);
      console.log(`  ${chalk.cyan('pan show --context materialize [file]')}   - List/read outputs`);
      console.log(`  ${chalk.cyan('pan show --context tokens <file>')}        - Estimate token count`);
      console.log('');
  }
}
