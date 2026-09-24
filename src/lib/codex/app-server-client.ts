/**
 * Async client for a Codex app-server host's authenticated control socket
 * (PAN-3835). The host listens on `~/.overdeck/sockets/appserver-<agentId>.sock`
 * and accepts only POSTs carrying the token it wrote to
 * `~/.overdeck/agents/<agentId>/appserver-token`.
 *
 * Unlike the older helpers in conversation-delivery.ts and runtime-command.ts,
 * this one never touches the filesystem synchronously, so dashboard-server
 * code can call it on a request path. It returns every HTTP status to the
 * caller instead of throwing on 4xx, because the companion adapter maps those
 * bodies to readable unavailable reasons.
 */
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { BRIDGE_TOKEN_HEADER } from '../bridge-token.js';

export interface HostOpResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export type HostOpOutcome =
  | { readonly ok: true; readonly response: HostOpResponse }
  /** The host could not be reached: no token, no socket, refused, or timed out. */
  | { readonly ok: false; readonly reason: 'token-missing' | 'unreachable'; readonly message: string };

export interface CodexHostClientOptions {
  readonly overdeckHome: string;
  readonly timeoutMs?: number;
}

const CODEX_HOST_OP_TIMEOUT_MS = 10_000;

async function readToken(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, 'utf-8')).trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function postCodexHostOp(
  agentId: string,
  body: Record<string, unknown>,
  options: CodexHostClientOptions,
): Promise<HostOpOutcome> {
  const token = await readToken(join(options.overdeckHome, 'agents', agentId, 'appserver-token'));
  if (!token) return { ok: false, reason: 'token-missing', message: `app-server token missing for ${agentId}` };
  const socketPath = join(options.overdeckHome, 'sockets', `appserver-${agentId}.sock`);
  const payload = JSON.stringify(body);
  const timeoutMs = options.timeoutMs ?? CODEX_HOST_OP_TIMEOUT_MS;

  return new Promise<HostOpOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: HostOpOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const req = httpRequest(
      {
        socketPath,
        path: '/',
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          [BRIDGE_TOKEN_HEADER]: token,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk: string) => { text += chunk; });
        res.on('end', () => {
          let parsed: unknown = {};
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            parsed = { error: text };
          }
          const record = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
          finish({ ok: true, response: { status: res.statusCode ?? 0, body: record } });
        });
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish({ ok: false, reason: 'unreachable', message: `app-server host did not answer within ${timeoutMs}ms` });
    }, timeoutMs);
    req.on('error', (error) => finish({ ok: false, reason: 'unreachable', message: error.message }));
    req.end(payload);
  });
}
