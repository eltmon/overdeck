import chalk from 'chalk';
import {
  getAgentCVSync,
  getAgentRankingsSync,
  formatCVSync,
  startWorkSync,
  completeWorkSync,
} from '../../lib/cv.js';

interface CVOptions {
  json?: boolean;
  rankings?: boolean;
}

export async function cvCommand(agentId?: string, options: CVOptions = {}): Promise<void> {
  // Show rankings
  if (options.rankings || !agentId) {
    const rankings = getAgentRankingsSync();

    if (options.json) {
      console.log(JSON.stringify(rankings, null, 2));
      return;
    }

    if (rankings.length === 0) {
      console.log(chalk.dim('No agent work history yet.'));
      console.log(chalk.dim('CVs are created as agents complete work.'));
      return;
    }

    console.log(chalk.bold('\nAgent Rankings\n'));

    // Header
    console.log(
      `${'Agent'.padEnd(25)} ${'Success'.padStart(8)} ${'Total'.padStart(6)} ${'Avg Time'.padStart(10)}`
    );
    console.log(chalk.dim('─'.repeat(52)));

    for (let i = 0; i < rankings.length; i++) {
      const r = rankings[i];
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
      const successPct = `${(r.successRate * 100).toFixed(0)}%`;
      const avgTime = r.avgDuration > 0 ? `${r.avgDuration}m` : '-';

      console.log(
        `${medal} ${r.agentId.padEnd(22)} ${successPct.padStart(8)} ${r.totalIssues
          .toString()
          .padStart(6)} ${avgTime.padStart(10)}`
      );
    }

    console.log('');
    console.log(chalk.dim(`Use: pan show --cv <agent-id> for details`));
    return;
  }

  // Show specific agent CV
  const normalizedId = agentId.startsWith('agent-') ? agentId : `agent-${agentId.toLowerCase()}`;
  const cv = getAgentCVSync(normalizedId);

  if (options.json) {
    console.log(JSON.stringify(cv, null, 2));
    return;
  }

  console.log('');
  console.log(formatCVSync(cv));
}

// Export helper functions for integration
export { startWorkSync, completeWorkSync };
