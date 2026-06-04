import type { RuntimeName } from '../../lib/runtimes/types.js';

/**
 * Drive a conversation fork/handoff through the dashboard server.
 *
 * PAN-1568: the CLI must NOT fork in-process. Spawning a forked conversation's
 * tmux session is owned by the server (`spawnConversationSession` pulls in the
 * PTY supervisor, channels MCP, provider-env resolution, permission flags,
 * etc.), and the conversation-lifecycle service running inside the server is
 * what keeps the session registered. The old in-process `createSummaryFork`
 * path authored the doc and wrote the conversation row but never spawned, so
 * every CLI fork/handoff was born dead — the lifecycle reaper marked it
 * `ended` within one poll.
 *
 * The server route `POST /api/conversations/:name/summary-fork` is the single
 * owner of the full pipeline: it authors (for handoff), creates the row, and
 * spawns via `runForkPipeline`. This helper POSTs to that route and then polls
 * the new conversation until the fork pipeline finishes (forkStatus cleared) or
 * fails — preserving the CLI's synchronous "here are the final details" UX.
 */

export interface ForkViaServerOptions {
  forkMode: 'plain' | 'summary' | 'handoff';
  /** local-only heuristic summary (no LLM) — the "fast summary" mode. */
  localSummaryOnly?: boolean;
  includeThinkingInSummary?: boolean;
  model?: string;
  summaryModel?: string;
  cwd?: string;
  harness?: RuntimeName;
  summaryHarness?: RuntimeName;
  title?: string;
  focus?: string;
  handoffAuthor?: 'source' | 'external';
  handoffAuthorModel?: string;
  handoffAuthorHarness?: RuntimeName;
}

export interface ForkResultConv {
  id: number;
  name: string;
  tmuxSession: string;
  model?: string | null;
  harness?: string | null;
  forkStatus?: string | null;
  forkError?: string | null;
  forkFallbackReason?: string | null;
  handoffDocPath?: string | null;
  sessionAlive?: boolean;
  status?: string;
}

export class ForkServerError extends Error {}

/**
 * Loopback base URL for the dashboard API. Mirrors the resolution used by other
 * CLI→server callers (`src/lib/agent-runtime.ts`): prefer an explicit override,
 * otherwise hit the local API on 127.0.0.1 over plain HTTP. We deliberately do
 * NOT fall back to `DASHBOARD_URL` (which can be the Traefik `https://pan.localhost`
 * origin) — a self-signed TLS hop would just make a loopback call fail.
 */
function dashboardBaseUrl(): string {
  return (process.env['PANOPTICON_DASHBOARD_URL'] || 'http://127.0.0.1:3011').replace(/\/$/, '');
}

export async function forkConversationViaServer(
  sourceName: string,
  opts: ForkViaServerOptions,
  { timeoutMs = 240_000, pollMs = 2_000 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<ForkResultConv> {
  const base = dashboardBaseUrl();
  const url = `${base}/api/conversations/${encodeURIComponent(sourceName)}/summary-fork`;

  const body: Record<string, unknown> = { forkMode: opts.forkMode };
  if (opts.localSummaryOnly) body['localSummaryOnly'] = true;
  if (opts.includeThinkingInSummary) body['includeThinkingInSummary'] = true;
  if (opts.model) body['model'] = opts.model;
  if (opts.summaryModel) body['summaryModel'] = opts.summaryModel;
  if (opts.cwd) body['cwd'] = opts.cwd;
  if (opts.harness) body['harness'] = opts.harness;
  if (opts.summaryHarness) body['summaryHarness'] = opts.summaryHarness;
  if (opts.title) body['title'] = opts.title;
  if (opts.focus) body['focus'] = opts.focus;
  if (opts.handoffAuthor) body['handoffAuthor'] = opts.handoffAuthor;
  if (opts.handoffAuthorModel) body['handoffAuthorModel'] = opts.handoffAuthorModel;
  if (opts.handoffAuthorHarness) body['handoffAuthorHarness'] = opts.handoffAuthorHarness;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      // The server enforces a same-origin CSRF check on mutating requests. Send
      // an Origin matching the loopback API base, which is always in the
      // server's trusted-origin set (see routes/origin-validation.ts).
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ForkServerError(
      `Could not reach the Panopticon dashboard at ${base}. Forks and handoffs are spawned by the dashboard server — start it with \`pan up\`. (${(err as Error).message})`,
    );
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) detail = j.error;
    } catch {
      /* non-JSON body — keep the status code */
    }
    throw new ForkServerError(`Fork request rejected: ${detail}`);
  }

  const created = (await res.json()) as { conversation?: ForkResultConv };
  const conv = created.conversation;
  if (!conv?.id) throw new ForkServerError('Dashboard did not return a conversation');

  // The server runs the fork pipeline (author + spawn) asynchronously. Poll the
  // new conversation until its forkStatus clears (live) or reports failure.
  const deadline = Date.now() + timeoutMs;
  let latest = conv;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    try {
      const g = await fetch(`${base}/api/conversations/${conv.id}`);
      if (!g.ok) continue;
      latest = (await g.json()) as ForkResultConv;
    } catch {
      continue;
    }
    const fs = latest.forkStatus;
    if (fs === null || fs === undefined || fs === 'failed') break;
  }
  return latest;
}
