/**
 * `pan machines add-fly` (PAN-4652 WI-13, FR-11).
 *
 *   pan machines add-fly [--project <key>] [--message <text>] [--harness <name>]
 *     [--model <id>] [--effort <level>] [--region <code>] [--image <ref>] [--json]
 *
 * Asks the running dashboard (`POST /api/machines/fly`) to start a Fly VM that
 * runs `pan serve`, link it one way from here, and optionally clone a project
 * and start a Claude Code or Codex conversation on it (`--harness`, PAN-4296). The dashboard does the whole flow
 * in one request, 3–10 minutes with a clone (D-13). Node's global fetch gives
 * up on response headers after 300 s, so this verb sends the request with
 * `node:http`, which waits as long as the dashboard takes.
 */
import type { Command } from 'commander';

import { fail, NEEDS_PAN_UP, NOT_RUNNING } from './machines-call.js';

export interface AddFlyOptions {
  project?: string;
  message?: string;
  harness?: string;
  model?: string;
  effort?: string;
  region?: string;
  image?: string;
  json?: boolean;
}

interface AddFlyResponse {
  link: { label: string };
  record: { label: string; region: string; docker: boolean; appName: string; codexAuthPath: string | null };
  conversation?: { environmentId: string; name: string; path: string };
}

export type PostOutcome = { status: number; json: unknown } | { unreachable: string };

/**
 * POST to the dashboard with the internal token and no client timeout. A
 * connection that closes before the response completes (a dashboard restart)
 * resolves as unreachable instead of leaving the command waiting forever.
 *
 * Its production callers are runMachinesAddFly and startRemoteWorkAgent
 * (`pan start --remote`, PAN-4734).
 */
export async function postWithoutTimeout(base: string, path: string, body: unknown): Promise<PostOutcome> {
  const { ensureInternalToken, INTERNAL_TOKEN_HEADER } = await import('../../lib/internal-token.js');
  const url = new URL(path, base);
  const { request } = url.protocol === 'https:' ? await import('node:https') : await import('node:http');
  const payload = JSON.stringify(body);
  return new Promise((resolve) => {
    const req = request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
        [INTERNAL_TOKEN_HEADER]: ensureInternalToken(),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => {
        let json: unknown = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = { error: text };
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
      res.on('error', (error) => resolve({ unreachable: error.message }));
      res.on('close', () => {
        if (!res.complete) resolve({ unreachable: 'the dashboard closed the connection before it finished answering' });
      });
    });
    req.on('error', (error) => resolve({ unreachable: error.message }));
    req.end(payload);
  });
}

export async function runMachinesAddFly(options: AddFlyOptions): Promise<void> {
  const body: Record<string, unknown> = {};
  if (options.project) body.projectKey = options.project;
  if (options.message !== undefined) body.message = options.message;
  if (options.harness) body.harness = options.harness;
  if (options.model) body.model = options.model;
  if (options.effort) body.effort = options.effort;
  if (options.region) body.region = options.region;
  if (options.image) body.image = options.image;

  const { getDashboardApiUrl } = await import('../../lib/config.js');
  const base = getDashboardApiUrl();
  if (!options.json) console.log('Starting a Fly machine; this takes a few minutes (longer with a project clone)...');
  const outcome = await postWithoutTimeout(base, '/api/machines/fly', body);
  if ('unreachable' in outcome) return fail(NOT_RUNNING);
  if (outcome.status === 401) return fail(NEEDS_PAN_UP);
  if (outcome.status !== 201) {
    const error = outcome.json as { error?: unknown; message?: unknown } | null;
    const reason = typeof error?.message === 'string' ? error.message : typeof error?.error === 'string' ? error.error : `HTTP ${outcome.status}`;
    return fail(`pan machines add-fly failed: ${reason}`);
  }

  const result = outcome.json as AddFlyResponse;
  if (options.json) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(`Linked ${result.record.label} (Fly app ${result.record.appName}, region ${result.record.region}; docker: ${result.record.docker ? 'yes' : 'no'}; codex: ${result.record.codexAuthPath ? 'yes' : 'no'})`);
  if (result.conversation) console.log(`Open: ${base}${result.conversation.path}`);
  console.log('`pan machines list` shows its state; `pan machines unlink` destroys it.');
}

export function registerMachinesFlyCommands(machines: Command): void {
  machines
    .command('add-fly')
    .description('Start a Fly.io VM that runs Overdeck, link it from here, and optionally start a Claude Code or Codex conversation on it')
    .option('--project <key>', 'Clone this project onto the VM (GitHub projects only)')
    .option('--message <text>', 'Start a conversation with this first message (needs --project)')
    .option('--harness <name>', 'Harness for the conversation: claude-code (default) or codex')
    .option('--model <id>', 'Model for the conversation (required with --harness codex)')
    .option('--effort <level>', 'Reasoning effort for the conversation')
    .option('--region <code>', 'Fly region (default: remote.fly.region, else iad)')
    .option('--image <ref>', 'Image (default: remote.fly.image, else registry.fly.io/<app>:latest)')
    .option('--json', 'Print { link, record, conversation? } as JSON')
    .action((options: AddFlyOptions) => runMachinesAddFly(options));
}
