import chalk from 'chalk';
import ora from 'ora';
import { getDashboardApiUrlSync } from '../../lib/config.js';

interface PlanOptions {
  auto?: boolean;
  model?: string;
  harness?: 'claude-code' | 'pi';
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
  const spinner = ora(`${options.auto ? 'Auto-planning' : 'Starting planning for'} ${issueId}...`).start();

  try {
    const response = await fetch(`${getDashboardApiUrlSync()}/api/issues/${encodeURIComponent(issueId)}/start-planning`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auto: options.auto === true,
        model: options.model || undefined,
        harness: options.harness || undefined,
        effort: options.effort || undefined,
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

    const reader = response.body?.getReader();
    if (!reader) {
      spinner.succeed(`Planning started for ${issueId}`);
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let sessionName = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const event = JSON.parse(line.slice(6)) as { type?: string; label?: string; detail?: string; status?: string; sessionName?: string; error?: string };
        if (event.type === 'started') {
          sessionName = event.sessionName || sessionName;
        } else if (event.type === 'progress') {
          spinner.text = `${event.label ?? 'Planning'}${event.detail ? ` — ${event.detail}` : ''}`;
        } else if (event.type === 'error') {
          throw new Error(event.error || 'Planning setup failed');
        } else if (event.type === 'complete') {
          sessionName = event.sessionName || sessionName;
        }
      }
    }

    spinner.succeed(`${options.auto ? 'Auto-planning' : 'Planning'} session started for ${issueId}${sessionName ? ` (${sessionName})` : ''}`);
  } catch (error) {
    spinner.fail(error instanceof Error ? error.message : String(error));
    console.error(chalk.dim('Make sure the dashboard is running: pan up'));
    process.exit(1);
  }
}
