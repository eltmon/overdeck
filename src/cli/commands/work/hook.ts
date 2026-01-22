import chalk from 'chalk';
import {
  checkHook,
  pushToHook,
  popFromHook,
  clearHook,
  sendMail,
  generateFixedPointPrompt,
  HookItem,
} from '../../../lib/hooks.js';

interface HookOptions {
  json?: boolean;
}

export async function hookCommand(
  action: string,
  idOrMessage?: string,
  options: HookOptions = {}
): Promise<void> {
  // Normalize agent ID
  const agentId = process.env.PANOPTICON_AGENT_ID || 'default';

  switch (action) {
    case 'check': {
      const result = checkHook(idOrMessage || agentId);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result.hasWork) {
        console.log(chalk.green('✓ No pending work on hook'));
        return;
      }

      console.log(chalk.yellow(`⚠ ${result.items.length} item(s) on hook`));
      if (result.urgentCount > 0) {
        console.log(chalk.red(`  ${result.urgentCount} URGENT`));
      }
      console.log('');

      for (const item of result.items) {
        const priorityColor = {
          urgent: chalk.red,
          high: chalk.yellow,
          normal: chalk.white,
          low: chalk.dim,
        }[item.priority];

        console.log(`${priorityColor(`[${item.priority.toUpperCase()}]`)} ${item.id}`);
        console.log(`  Type: ${item.type}`);
        console.log(`  From: ${item.source}`);
        if (item.payload.message) {
          console.log(`  Message: ${item.payload.message}`);
        }
        console.log('');
      }
      break;
    }

    case 'push': {
      if (!idOrMessage) {
        console.log(chalk.red('Usage: pan work hook push <agent-id> <message>'));
        process.exit(1);
      }

      const [targetAgent, ...messageParts] = idOrMessage.split(' ');
      const message = messageParts.join(' ');

      if (!message) {
        console.log(chalk.red('Message required'));
        process.exit(1);
      }

      const item = pushToHook(targetAgent.startsWith('agent-') ? targetAgent : `agent-${targetAgent}`, {
        type: 'task',
        priority: 'normal',
        source: 'cli',
        payload: { message },
      });

      console.log(chalk.green(`✓ Pushed to hook: ${item.id}`));
      break;
    }

    case 'pop': {
      if (!idOrMessage) {
        console.log(chalk.red('Usage: pan work hook pop <item-id>'));
        process.exit(1);
      }

      const success = popFromHook(agentId, idOrMessage);
      if (success) {
        console.log(chalk.green(`✓ Popped: ${idOrMessage}`));
      } else {
        console.log(chalk.yellow(`Item not found: ${idOrMessage}`));
      }
      break;
    }

    case 'clear': {
      clearHook(idOrMessage || agentId);
      console.log(chalk.green('✓ Hook cleared'));
      break;
    }

    case 'mail': {
      if (!idOrMessage) {
        console.log(chalk.red('Usage: pan work hook mail <agent-id> <message>'));
        process.exit(1);
      }

      const [targetAgent, ...messageParts] = idOrMessage.split(' ');
      const message = messageParts.join(' ');

      if (!message) {
        console.log(chalk.red('Message required'));
        process.exit(1);
      }

      sendMail(
        targetAgent.startsWith('agent-') ? targetAgent : `agent-${targetAgent}`,
        'cli',
        message
      );

      console.log(chalk.green(`✓ Mail sent to ${targetAgent}`));
      break;
    }

    case 'fpp': {
      const prompt = generateFixedPointPrompt(idOrMessage || agentId);

      if (!prompt) {
        console.log(chalk.green('No fixed point work found'));
        return;
      }

      console.log(prompt);
      break;
    }

    default:
      console.log(chalk.bold('Hook Commands:'));
      console.log('');
      console.log(`  ${chalk.cyan('pan work hook check [agent-id]')}  - Check for pending work`);
      console.log(`  ${chalk.cyan('pan work hook push <agent-id> <msg>')}  - Push task to hook`);
      console.log(`  ${chalk.cyan('pan work hook pop <item-id>')}  - Remove completed item`);
      console.log(`  ${chalk.cyan('pan work hook clear [agent-id]')}  - Clear all hook items`);
      console.log(`  ${chalk.cyan('pan work hook mail <agent-id> <msg>')}  - Send mail to agent`);
      console.log(`  ${chalk.cyan('pan work hook fpp [agent-id]')}  - Generate FPP prompt`);
  }
}
