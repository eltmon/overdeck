import { Command } from 'commander';
import { issueCommand } from './issue.js';
import { statusCommand } from './status.js';
import { tellCommand } from './tell.js';
import { killCommand } from './kill.js';
import { pendingCommand } from './pending.js';
import { approveCommand } from './approve.js';
import { planCommand } from './plan.js';
import { listCommand } from './list.js';
import { triageCommand } from './triage.js';
import { hookCommand } from './hook.js';
import { recoverCommand } from './recover.js';
import { cvCommand } from './cv.js';
import { contextCommand } from './context.js';
import { healthCommand } from './health.js';
import { reopenCommand } from './reopen.js';

export function registerWorkCommands(program: Command): void {
  const work = program
    .command('work')
    .description('Agent and work management');

  work
    .command('issue <id>')
    .description('Spawn agent for Linear issue')
    .option('--model <model>', 'Claude model (sonnet/opus/haiku)', 'sonnet')
    .option('--runtime <runtime>', 'AI runtime (claude/codex)', 'claude')
    .option('--dry-run', 'Show what would be created')
    .action(issueCommand);

  work
    .command('status')
    .description('Show all running agents')
    .option('--json', 'Output as JSON')
    .action(statusCommand);

  work
    .command('tell <id> <message>')
    .description('Send message to running agent')
    .action(tellCommand);

  work
    .command('kill <id>')
    .description('Kill an agent')
    .option('--force', 'Kill without confirmation')
    .action(killCommand);

  work
    .command('pending')
    .description('Show completed work awaiting review')
    .action(pendingCommand);

  work
    .command('approve <id>')
    .description('Approve agent work, merge MR, update Linear')
    .option('--no-merge', 'Skip MR merge')
    .option('--no-linear', 'Skip Linear status update')
    .action(approveCommand);

  work
    .command('plan <id>')
    .description('Create execution plan before spawning')
    .option('-o, --output <path>', 'Output file path')
    .option('--json', 'Output as JSON')
    .option('--skip-discovery', 'Skip interactive discovery phase')
    .option('--force', 'Force planning even for simple issues')
    .action(planCommand);

  work
    .command('list')
    .description('List issues from configured trackers')
    .option('--all', 'Include closed issues')
    .option('--mine', 'Show only my assigned issues')
    .option('--json', 'Output as JSON')
    .option('--tracker <type>', 'Query specific tracker (linear/github/gitlab)')
    .option('--all-trackers', 'Query all configured trackers')
    .action(listCommand);

  work
    .command('triage [id]')
    .description('Triage secondary tracker issues')
    .option('--create', 'Create primary issue from secondary')
    .option('--dismiss <reason>', 'Dismiss from triage')
    .action(triageCommand);

  work
    .command('hook [action] [idOrMessage...]')
    .description('FPP hooks: check, push, pop, clear, mail, fpp')
    .option('--json', 'Output as JSON')
    .action((action, idOrMessage, options) => {
      hookCommand(action || 'help', idOrMessage?.join(' '), options);
    });

  work
    .command('recover [id]')
    .description('Recover crashed agents')
    .option('--all', 'Auto-recover all crashed agents')
    .option('--json', 'Output as JSON')
    .action(recoverCommand);

  work
    .command('cv [agentId]')
    .description('View agent CVs (work history) and rankings')
    .option('--json', 'Output as JSON')
    .option('--rankings', 'Show agent rankings')
    .action(cvCommand);

  work
    .command('context [action] [arg1] [arg2]')
    .description('Context engineering: state, checkpoint, history, materialize')
    .option('--json', 'Output as JSON')
    .action((action, arg1, arg2, options) => {
      contextCommand(action || 'help', arg1, arg2, options);
    });

  work
    .command('health [action] [id]')
    .description('Health monitoring: check, status, ping, recover, daemon')
    .option('--json', 'Output as JSON')
    .option('--interval <seconds>', 'Daemon check interval', '30')
    .action((action, id, options) => {
      healthCommand(action || 'help', id, {
        json: options.json,
        interval: parseInt(options.interval, 10),
      });
    });

  work
    .command('reopen <id>')
    .description('Reopen a closed/done issue and re-run planning')
    .option('--skip-plan', 'Skip automatic planning after reopen')
    .option('--json', 'Output as JSON')
    .option('--force', 'Skip confirmation')
    .action(reopenCommand);
}

// Re-export individual commands for direct use
export { statusCommand } from './status.js';
export { issueCommand } from './issue.js';
export { tellCommand } from './tell.js';
export { killCommand } from './kill.js';
