import chalk from 'chalk';
import ora from 'ora';
import { getDashboardApiUrlSync } from '../../lib/config.js';
import { buildStartPlanningBody, printPlanningConnectionError, streamPlanningSession } from './planning-stream.js';

interface PlanOptions {
  auto?: boolean;
  autoStart?: boolean;
  probe?: boolean;
  model?: string;
  harness?: 'claude-code' | 'pi' | 'codex';
  effort?: 'low' | 'medium' | 'high';
  remote?: boolean;
  local?: boolean;
}

export async function planCommand(id: string | undefined, options: PlanOptions): Promise<void> {
  if (!id) {
    console.error(chalk.red('Issue ID required. Usage: pan plan <id> [--auto]'));
    process.exit(1);
  }

  const issueId = id.toUpperCase();

  if (options.autoStart) {
    console.warn(chalk.yellow(
      '--auto-start is deprecated — pan start <id> now plans and starts work in one command. This flag keeps working through the deprecation window.',
    ));
  }

  const spinner = ora(`${options.auto ? 'Auto-planning' : 'Starting planning for'} ${issueId}...`).start();

  try {
    const response = await fetch(`${getDashboardApiUrlSync()}/api/issues/${encodeURIComponent(issueId)}/start-planning`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildStartPlanningBody({
        auto: options.auto === true,
        autoStart: options.autoStart === true,
        probe: options.probe === true,
        model: options.model,
        harness: options.harness,
        effort: options.effort,
        workspaceLocation: options.remote ? 'remote' : 'local',
      }),
    });

    if (!response.ok) {
      let message = `Planning failed (${response.status})`;
      try {
        const data = await response.json() as { error?: string; hint?: string };
        message = data.error || data.hint || message;
      } catch {
        const text = await response.text().catch(() => '');
        if (text) message = text;
      }
      spinner.fail(message);
      process.exit(1);
    }

    let sessionName = '';
    await streamPlanningSession(response, {
      issueId,
      setSpinnerText: (text) => { spinner.text = text; },
      onComplete: (name) => { sessionName = name; },
    });

    spinner.succeed(`${options.auto ? 'Auto-planning' : 'Planning'} session started for ${issueId}${sessionName ? ` (${sessionName})` : ''}`);
  } catch (error) {
    spinner.fail(error instanceof Error ? error.message : String(error));
    printPlanningConnectionError(issueId);
    process.exit(1);
  }
}
