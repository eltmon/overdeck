import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deliverAgentMessage } from '../delivery.js';
import { resolveRecoveryResumeSessionId } from '../recovery.js';

let tempHome: string;
let prevOverdeckHome: string | undefined;
let servers: Server[] = [];

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-resume-test-'));
  prevOverdeckHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
});

afterEach(() => {
  for (const server of servers) {
    server.close();
  }
  servers = [];
  if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevOverdeckHome;
  rmSync(tempHome, { recursive: true, force: true });
});

function agentDir(agentId: string): string {
  return join(tempHome, 'agents', agentId);
}

describe('resolveRecoveryResumeSessionId', () => {
  it('returns the persisted Codex thread id for recovery launchers', () => {
    const agentId = 'agent-codex-resume';
    mkdirSync(agentDir(agentId), { recursive: true });
    writeFileSync(join(agentDir(agentId), 'codex-thread-id'), 'thread-123\n');

    expect(resolveRecoveryResumeSessionId(agentId, 'codex')).toBe('thread-123');
  });

  it('does not apply Codex thread ids to other harnesses', () => {
    const agentId = 'agent-claude-resume';
    mkdirSync(agentDir(agentId), { recursive: true });
    writeFileSync(join(agentDir(agentId), 'codex-thread-id'), 'thread-ignored\n');

    expect(resolveRecoveryResumeSessionId(agentId, 'claude-code')).toBeUndefined();
  });

  it('falls back to the latest rollout thread id when the explicit file is absent', () => {
    const agentId = 'agent-codex-rollout-resume';
    const sessionsDir = join(agentDir(agentId), 'codex-home', 'sessions', '2026', '07', '12');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, 'rollout-2026-07-12T14-28-38-019f5796-a6eb-7ec0-91e6-ac452b37e193.jsonl'),
      '{"type":"session_meta","payload":{"id":"019f5796-a6eb-7ec0-91e6-ac452b37e193"}}\n',
    );

    expect(resolveRecoveryResumeSessionId(agentId, 'codex')).toBe('019f5796-a6eb-7ec0-91e6-ac452b37e193');
  });
});

describe('resume Codex app-server delivery', () => {
  it('delivers the continue prompt through the app-server socket tier', async () => {
    const agentId = 'agent-codex-delivery';
    const socketDir = join(tempHome, 'sockets');
    mkdirSync(socketDir, { recursive: true });
    mkdirSync(agentDir(agentId), { recursive: true });
    writeFileSync(join(agentDir(agentId), 'appserver-token'), 'token-123\n');

    let resolveReceived!: (body: string) => void;
    const received = new Promise<string>((resolve) => {
      resolveReceived = resolve;
    });
    const server = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf-8');
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        resolveReceived(body);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(join(socketDir, `appserver-${agentId}.sock`), resolve);
    });

    const result = await deliverAgentMessage(agentId, 'continue now', 'resumeAgent:codex-continue');

    expect(result).toEqual({ ok: true, path: 'app-server' });
    await expect(received).resolves.toBe(JSON.stringify({
      op: 'message',
      content: 'continue now',
      meta: { caller: 'resumeAgent:codex-continue' },
    }));
  });
});
