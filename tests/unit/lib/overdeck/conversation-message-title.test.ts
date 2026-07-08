/**
 * Tests for workspace-03p5n — HTTP message path sets deterministic title before optional AI title.
 *
 * AC1: handleConversationMessage on a titleSource='default' conversation persists a deterministic
 *      'auto' title synchronously in the request path, even when backgroundAi.cheapMode=true.
 * AC2: generateAiTitle is still invoked (fire-and-forget) when background titles are enabled.
 * AC3: The handler preserves conversations with titleSource other than 'default' unmodified.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-conv-message-title-test-'));
  process.env.OVERDECK_HOME = testHome;
});

afterEach(async () => {
  const { closeOverdeckDatabaseSync } = await import('../../../../src/lib/overdeck/infra.js');
  closeOverdeckDatabaseSync();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('handleConversationMessage title behavior', () => {
  it('sets a deterministic auto title for titleSource=default and still calls generateAiTitle', async () => {
    vi.doMock('../../../../src/lib/agents.js', () => ({
      deliverAgentMessage: vi.fn().mockResolvedValue(undefined),
      injectPiConversationMemory: vi.fn().mockImplementation(async (_ctx: unknown, message: string) => message),
    }));
    vi.doMock('../../../../src/dashboard/server/http-helpers.js', () => ({
      jsonResponse: vi.fn((body: unknown, options?: number | { status?: number }) => {
        const status = typeof options === 'number' ? options : options?.status ?? 200;
        return { status, body };
      }),
    }));

    const { handleConversationMessage } = await import(
      '../../../../src/lib/overdeck/conversation-message.js'
    );
    const { createConversation, getConversationByName } = await import(
      '../../../../src/lib/overdeck/conversations.js'
    );

    const generateAiTitle = vi.fn().mockResolvedValue(undefined);

    createConversation({
      name: 'http-title-default',
      tmuxSession: 'tmux-http-title-default',
      cwd: '/tmp',
      title: 'New conversation',
      titleSource: 'default',
    });

    const response = await handleConversationMessage(
      'http-title-default',
      { message: 'Please help me refactor the auth middleware in src/auth.ts' },
      { generateAiTitle },
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });

    const conv = getConversationByName('http-title-default');
    expect(conv?.title).toBe('refactor the auth middleware in src/auth.ts');
    expect(conv?.titleSource).toBe('auto');
    expect(generateAiTitle).toHaveBeenCalledWith('http-title-default', 'Please help me refactor the auth middleware in src/auth.ts');

    vi.doUnmock('../../../../src/lib/agents.js');
    vi.doUnmock('../../../../src/dashboard/server/http-helpers.js');
  });

  it('does not write a title when titleSource is not default', async () => {
    vi.doMock('../../../../src/lib/agents.js', () => ({
      deliverAgentMessage: vi.fn().mockResolvedValue(undefined),
      injectPiConversationMemory: vi.fn().mockImplementation(async (_ctx: unknown, message: string) => message),
    }));
    vi.doMock('../../../../src/dashboard/server/http-helpers.js', () => ({
      jsonResponse: vi.fn((body: unknown, options?: number | { status?: number }) => {
        const status = typeof options === 'number' ? options : options?.status ?? 200;
        return { status, body };
      }),
    }));

    const { handleConversationMessage } = await import(
      '../../../../src/lib/overdeck/conversation-message.js'
    );
    const { createConversation, getConversationByName } = await import(
      '../../../../src/lib/overdeck/conversations.js'
    );

    const generateAiTitle = vi.fn().mockResolvedValue(undefined);

    createConversation({
      name: 'http-title-manual',
      tmuxSession: 'tmux-http-title-manual',
      cwd: '/tmp',
      title: 'My Manual Title',
      titleSource: 'manual',
    });

    const response = await handleConversationMessage(
      'http-title-manual',
      { message: 'Please help me refactor the auth middleware' },
      { generateAiTitle },
    );

    expect(response.status).toBe(200);

    const conv = getConversationByName('http-title-manual');
    expect(conv?.title).toBe('My Manual Title');
    expect(conv?.titleSource).toBe('manual');
    expect(generateAiTitle).not.toHaveBeenCalled();

    vi.doUnmock('../../../../src/lib/agents.js');
    vi.doUnmock('../../../../src/dashboard/server/http-helpers.js');
  });
});
