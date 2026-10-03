import chalk from 'chalk';
import { exitCli } from '../exit.js';
import { dashboardBaseUrl, ForkServerError, waitForForkPipeline, type ForkResultConv } from './fork-client.js';
import { resolveConversation } from './handoff-shared.js';

/** PAN-4499 WI-7: send a `--hold` conversation's kickoff through the kickoff door. */
export async function handoffStartCommand(convRef: string): Promise<void> {
  const conv = resolveConversation(convRef);
  if (!conv) {
    console.log(chalk.yellow(`Conversation not found: ${convRef}`));
    return exitCli(1);
  }

  const base = dashboardBaseUrl();
  const url = `${base}/api/conversations/${encodeURIComponent(conv.name)}/kickoff`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({}),
    });
  } catch (err) {
    console.log(chalk.red(
      `Could not reach the Overdeck dashboard at ${base}. Forks and handoffs are spawned by the dashboard server — start it with \`pan up\`. (${(err as Error).message})`,
    ));
    return exitCli(1);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) detail = j.error;
    } catch {
      /* non-JSON body — keep the status code */
    }
    console.log(chalk.red(detail));
    return exitCli(1);
  }

  const started = (await res.json()) as { conversation?: ForkResultConv };
  if (!started.conversation?.id) throw new ForkServerError('Dashboard did not return a conversation');

  const latest = await waitForForkPipeline(base, started.conversation, { timeoutMs: 60_000, pollMs: 1_000 });
  if (latest.forkStatus === 'failed') {
    console.log(chalk.red(`Kickoff failed: ${latest.forkError ?? 'unknown error'}`));
    return exitCli(1);
  }

  console.log(chalk.green(`Started conversation ${conv.name} — kickoff delivered`));
  console.log(chalk.gray(`  Dashboard: https://overdeck.localhost/conv/${latest.id}`));
}
