/**
 * `pan triggers` — manage webhook triggers (PAN-4648).
 *
 *   pan triggers add <name> (--conversation <name-or-id> | --project <key>) [--inbox] [options]
 *   pan triggers list [--json]
 *   pan triggers remove <id>
 *   pan triggers set-secret <id> [--secret <value>]
 *
 * Every verb uses the trigger store (`~/.overdeck/triggers.json`) directly, so
 * it works with the dashboard down; the delivery route reads the file on every
 * event, so a change applies to the next event. `add` prints the URL secret
 * once, with the Tailscale Funnel command that publishes `/hooks`. No verb
 * prints a signing secret except a generated one, once, from `add`. See
 * configuration/triggers.mdx.
 *
 * `add --inbox` (PAN-2356) goes through the running dashboard instead, because only the dashboard
 * holds the overdeck.ai directory socket that creates the inbox; it prints the inbox URL in place
 * of the Funnel lines.
 *
 * `src/cli/index.ts` imports this module at startup to register the verbs, so
 * it imports only Commander types and chalk statically. Everything else loads
 * inside each handler.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

const DOCS_PAGE = 'configuration/triggers.mdx';

export interface TriggersAddOptions {
  conversation?: string;
  project?: string;
  prompt?: string;
  promptFile?: string;
  verify?: string;
  signingSecret?: string;
  model?: string;
  harness?: string;
  effort?: string;
  inbox?: boolean;
  json?: boolean;
}

async function fail(message: string): Promise<never> {
  console.error(chalk.red(message));
  const { exitCli } = await import('../exit.js');
  return exitCli(1);
}

async function readTemplate(options: TriggersAddOptions): Promise<string | null> {
  if (options.prompt !== undefined && options.promptFile !== undefined) return fail('Pass --prompt or --prompt-file, not both.');
  if (options.promptFile !== undefined) {
    const { readFile } = await import('node:fs/promises');
    try {
      return await readFile(options.promptFile, 'utf8');
    } catch (error) {
      return fail(`Cannot read ${options.promptFile}: ${(error as Error).message}`);
    }
  }
  return options.prompt ?? null;
}

export async function runTriggersAdd(name: string, options: TriggersAddOptions): Promise<void> {
  if ((options.conversation === undefined) === (options.project === undefined)) {
    return fail('Pass exactly one of --conversation <name-or-id> or --project <key>.');
  }
  const template = await readTemplate(options);
  const setup = await import('../../lib/triggers/setup.js');
  const requested = options.conversation !== undefined
    ? { kind: 'conversation', conversation: options.conversation }
    : { kind: 'project', projectKey: options.project, model: options.model, harness: options.harness, effort: options.effort };
  const resolved = setup.resolveTriggerTarget(requested);
  if (!resolved.ok) return fail(resolved.error);
  if (options.inbox) return addWithInbox(name, requested, template, options);

  const { createTrigger } = await import('../../lib/triggers/store.js');
  let created: Awaited<ReturnType<typeof createTrigger>>;
  try {
    created = await createTrigger({
      name,
      target: resolved.target,
      template,
      verify: (options.verify ?? 'none') as 'none' | 'github' | 'stripe',
      signingSecret: options.signingSecret ?? null,
    });
  } catch (error) {
    return fail((error as Error).message);
  }

  const { readSavedTrustedOriginsSync } = await import('../../lib/remote-access/trusted-origins.js');
  const { trigger, hookPath, generatedSigningSecret } = created;
  const baseUrl = setup.triggerFunnelBaseUrl(readSavedTrustedOriginsSync());
  const localUrl = `http://127.0.0.1:${setup.triggerDashboardPort()}${hookPath}`;
  const funnelCommand = setup.triggerFunnelCommand();
  if (options.json) {
    console.log(JSON.stringify({ trigger, hookPath, url: baseUrl ? `${baseUrl}${hookPath}` : null, localUrl, funnelCommand, generatedSigningSecret }));
    return;
  }
  console.log(`Created trigger ${trigger.id} ("${trigger.name}")`);
  console.log(`  hook path:  ${hookPath}`);
  console.log(`  local test: ${localUrl}`);
  console.log(`  Funnel URL: ${baseUrl ?? setup.TRIGGER_FUNNEL_PLACEHOLDER_BASE}${hookPath}`);
  if (generatedSigningSecret) {
    console.log(`  signing secret (paste into the GitHub webhook form): ${generatedSigningSecret}`);
  }
  if (trigger.verify === 'stripe' && !trigger.signingSecretSet) {
    console.log(`  Stripe: run \`pan triggers set-secret ${trigger.id}\` with the endpoint's whsec_ secret before events can arrive.`);
  }
  console.log(`\nPublish /hooks with Tailscale Funnel:\n  ${funnelCommand}`);
  console.log('\nThe URL is shown once. Save it now.');
}

/** `add --inbox`: create through the dashboard, which asks the directory for the inbox. */
async function addWithInbox(name: string, target: Record<string, unknown>, template: string | null, options: TriggersAddOptions): Promise<void> {
  const { callDashboard, errorText, isDashboardUnreachable } = await import('./dashboard-call.js');
  let response: Response;
  try {
    response = await callDashboard('/api/triggers', {
      method: 'POST',
      body: { name, target, template, verify: options.verify ?? 'none', signingSecret: options.signingSecret ?? null, inbox: true },
    });
  } catch (error) {
    if (isDashboardUnreachable(error)) return fail('--inbox needs the running dashboard. Start it with pan up, then retry.');
    throw error;
  }
  if (!response.ok) return fail(`Could not create the trigger with an inbox: ${await errorText(response)}`);
  const created = (await response.json()) as {
    trigger: { id: string; name: string; verify: string; signingSecretSet: boolean };
    hookPath: string;
    inboxUrl: string;
    generatedSigningSecret: string | null;
  };
  if (options.json) {
    console.log(JSON.stringify(created));
    return;
  }
  const { trigger, inboxUrl, generatedSigningSecret } = created;
  console.log(`Created trigger ${trigger.id} ("${trigger.name}") with an overdeck.ai inbox`);
  console.log(`  inbox URL:  ${inboxUrl}`);
  if (generatedSigningSecret) {
    console.log(`  signing secret (paste into the GitHub webhook form): ${generatedSigningSecret}`);
  }
  if (trigger.verify === 'stripe' && !trigger.signingSecretSet) {
    console.log(`  Stripe: run \`pan triggers set-secret ${trigger.id}\` with the endpoint's whsec_ secret before events can arrive.`);
  }
  console.log('\nThe inbox holds events for 24 hours while this machine is offline. The URL is shown once. Save it now.');
}

export async function runTriggersList(options: { json?: boolean }): Promise<void> {
  const { listPublicTriggers } = await import('../../lib/triggers/store.js');
  let triggers: Awaited<ReturnType<typeof listPublicTriggers>>;
  try {
    triggers = await listPublicTriggers();
  } catch (error) {
    return fail((error as Error).message);
  }
  if (options.json) {
    console.log(JSON.stringify(triggers));
    return;
  }
  if (triggers.length === 0) {
    console.log('No triggers. Create one with `pan triggers add`.');
    return;
  }
  const header = ['ID', 'NAME', 'TARGET', 'VERIFY', 'SIGNING SECRET', 'CREATED'];
  const rows = triggers.map((t) => [
    t.id,
    t.name,
    t.target.kind === 'conversation' ? `conversation ${t.target.conversation}` : `project ${t.target.projectKey}`,
    t.verify,
    t.verify === 'none' ? '-' : t.signingSecretSet ? 'secret set' : 'secret not set',
    t.createdAt,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd();
  console.log(chalk.bold(line(header)));
  for (const row of rows) console.log(line(row));
}

export async function runTriggersRemove(id: string): Promise<void> {
  const { removeTrigger } = await import('../../lib/triggers/store.js');
  let removed: boolean;
  try {
    removed = await removeTrigger(id);
  } catch (error) {
    return fail((error as Error).message);
  }
  if (!removed) return fail(`No trigger with id ${id}.`);
  console.log(`Removed trigger ${id}. Its URL now answers 404.`);
}

/** First line of stdin, without its line ending. */
async function readStdinLine(): Promise<string> {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, terminal: false });
  try {
    for await (const line of rl) return line;
    return '';
  } finally {
    rl.close();
  }
}

export async function runTriggersSetSecret(
  id: string,
  options: { secret?: string },
  readLine: () => Promise<string> = readStdinLine,
): Promise<void> {
  if (options.secret === undefined && process.stdin.isTTY) console.error('Paste the signing secret, then press Enter:');
  const secret = (options.secret ?? (await readLine())).trim();
  if (!secret) return fail('No signing secret given.');
  const { setTriggerSigningSecret } = await import('../../lib/triggers/store.js');
  let updated: Awaited<ReturnType<typeof setTriggerSigningSecret>>;
  try {
    updated = await setTriggerSigningSecret(id, secret);
  } catch (error) {
    return fail((error as Error).message);
  }
  if (!updated) return fail(`No trigger with id ${id}.`);
  console.log(`Set the signing secret for trigger ${id}.`);
}

export function registerTriggersCommands(program: Command): void {
  const triggers = program
    .command('triggers')
    .description(`Manage webhook triggers that message or start conversations (see ${DOCS_PAGE})`);
  triggers
    .command('add <name>')
    .description('Create a trigger and print its secret URL once')
    .option('--conversation <name-or-id>', 'Send each event as a message to this conversation')
    .option('--project <key>', 'Start a new conversation in this project for each event')
    .option('--prompt <text>', 'Prompt template placed before the event (required for --project)')
    .option('--prompt-file <path>', 'Read the prompt template from a file')
    .option('--verify <kind>', 'Signature check: none, github or stripe', 'none')
    .option('--signing-secret <value>', 'HMAC signing secret (github generates one when omitted)')
    .option('--model <id>', 'Model for conversations a project trigger starts')
    .option('--harness <name>', 'Harness for conversations a project trigger starts')
    .option('--effort <level>', 'Reasoning effort for conversations a project trigger starts')
    .option('--inbox', 'Hold events while this machine is offline in an overdeck.ai inbox (Anywhere plan; needs the dashboard)')
    .option('--json', 'Print { trigger, hookPath, url, localUrl, funnelCommand, generatedSigningSecret } as JSON')
    .action((name: string, options: TriggersAddOptions) => runTriggersAdd(name, options));
  triggers
    .command('list')
    .description('List triggers with their targets and verification; never prints secrets')
    .option('--json', 'Print the triggers as JSON')
    .action((options: { json?: boolean }) => runTriggersList(options));
  triggers
    .command('remove <id>')
    .description('Remove a trigger; its URL answers 404 at once')
    .action((id: string) => runTriggersRemove(id));
  triggers
    .command('set-secret <id>')
    .description('Set the signing secret of a github or stripe trigger (reads one line from stdin without --secret)')
    .option('--secret <value>', 'The signing secret')
    .action((id: string, options: { secret?: string }) => runTriggersSetSecret(id, options));
}
