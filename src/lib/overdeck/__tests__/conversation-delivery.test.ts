import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let transport: 'app-server' | 'tui' = 'app-server';
let tmpHome: string;
let nextResponses: unknown[] = [];
const httpBodies: unknown[] = [];

vi.mock('../../config-yaml.js', () => ({
  loadConfigSync: () => ({ config: { codex: { transport } } }),
}));

vi.mock('../conversations.js', () => ({
  getConversationById: vi.fn(() => null),
  getConversationByName: vi.fn(() => ({
    id: 1,
    name: 'conv-test',
    tmuxSession: 'conv-test',
    harness: 'codex',
  })),
  setConversationEffort: vi.fn(),
  updateConversationDeliveryMethod: vi.fn(),
}));

vi.mock('../conversation-runtime.js', () => ({
  tmuxSessionExists: vi.fn(async () => true),
}));

vi.mock('../../agent-input-detection.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    detectAwaitingInputForAgent: vi.fn(() => Effect.succeed({
      reason: 'other',
      prompt: 'Would you like to run the following command?\n\nls\n\n1. Yes\n2. No',
    })),
  };
});

vi.mock('../../tmux.js', () => ({
  sendRawKeystroke: vi.fn(() => Effect.void),
  sendKeysAsync: vi.fn(async () => {}),
}));

vi.mock('node:http', () => ({
  request: vi.fn((_options, callback) => {
    const req = new EventEmitter() as EventEmitter & { write: (chunk: string) => void; end: () => void };
    let body = '';
    req.write = (chunk: string) => {
      body += chunk;
    };
    req.end = () => {
      httpBodies.push(JSON.parse(body));
      const response = new EventEmitter() as EventEmitter & { statusCode: number; setEncoding: (encoding: string) => void };
      response.statusCode = 200;
      response.setEncoding = vi.fn();
      callback(response);
      queueMicrotask(() => {
        response.emit('data', JSON.stringify(nextResponses.shift() ?? { ok: true }));
        response.emit('end');
      });
    };
    return req;
  }),
}));

import { detectAwaitingInputForAgent } from '../../agent-input-detection.js';
import { sendRawKeystroke } from '../../tmux.js';
import { codexConversationPendingInput, handleConversationCodexApproval } from '../conversation-delivery.js';

function seedAppServerFiles(session = 'conv-test'): void {
  mkdirSync(join(tmpHome, 'agents', session), { recursive: true });
  mkdirSync(join(tmpHome, 'sockets'), { recursive: true });
  writeFileSync(join(tmpHome, 'agents', session, 'appserver-token'), 'token-123\n');
  writeFileSync(join(tmpHome, 'sockets', `appserver-${session}.sock`), '');
}

describe('conversation codex approvals', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'pan-conv-delivery-'));
    process.env.OVERDECK_HOME = tmpHome;
    transport = 'app-server';
    nextResponses = [];
    httpBodies.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.OVERDECK_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('sources app-server pending approval input from status without pane capture', async () => {
    seedAppServerFiles();
    nextResponses.push({
      pendingRequests: [{
        id: 71,
        method: 'item/commandExecution/requestApproval',
        params: { command: 'git status' },
      }],
    });

    const result = await codexConversationPendingInput({
      id: 1,
      name: 'conv-test',
      tmuxSession: 'conv-test',
      harness: 'codex',
    } as never, true, '2026-07-12T00:00:00.000Z');

    expect(result.kinds).toEqual(['permissionRequest']);
    expect(result.approval?.toolUseId).toBe('codex-approval:conv-test:71');
    expect(result.approval?.questions[0]?.question).toContain('git status');
    expect(detectAwaitingInputForAgent).not.toHaveBeenCalled();
    expect(httpBodies).toEqual([{ op: 'status' }]);
  });

  it('posts app-server approval decisions instead of sending digit keystrokes', async () => {
    seedAppServerFiles();
    nextResponses.push(
      {
        pendingRequests: [{
          id: 71,
          method: 'item/commandExecution/requestApproval',
          params: { command: 'git status' },
        }],
      },
      { ok: true },
    );

    await handleConversationCodexApproval('conv-test', {
      optionNumber: 1,
      toolUseId: 'codex-approval:conv-test:71',
    });

    expect(httpBodies).toEqual([
      { op: 'status' },
      { op: 'approval', requestId: 71, decision: 'accept' },
    ]);
    expect(sendRawKeystroke).not.toHaveBeenCalled();
  });

  it('rejects app-server approval decisions for stale request ids', async () => {
    seedAppServerFiles();
    nextResponses.push({
      pendingRequests: [{
        id: 72,
        method: 'item/commandExecution/requestApproval',
        params: { command: 'git status' },
      }],
    });

    const response = await handleConversationCodexApproval('conv-test', {
      optionNumber: 1,
      toolUseId: 'codex-approval:conv-test:71',
    });

    expect(response.status).toBe(409);
    expect(httpBodies).toEqual([{ op: 'status' }]);
    expect(sendRawKeystroke).not.toHaveBeenCalled();
  });

  it('preserves the digit-keystroke approval path for tui transport', async () => {
    vi.useFakeTimers();
    transport = 'tui';

    const handled = handleConversationCodexApproval('conv-test', { optionNumber: 2 });
    await vi.advanceTimersByTimeAsync(70);
    await handled;

    expect(httpBodies).toHaveLength(0);
    expect(sendRawKeystroke).toHaveBeenNthCalledWith(1, 'conv-test', 'Down', 'codex-approval');
    expect(sendRawKeystroke).toHaveBeenNthCalledWith(2, 'conv-test', 'Enter', 'codex-approval');
  });
});
