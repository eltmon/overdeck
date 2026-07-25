import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { getAgentState, messageAgent } from '../../../../lib/agents.js';
import {
  ComposerCommandConfirmationError,
  composerCommandConfirmationFromBody,
  type ComposerCommandConfirmationInput,
} from '../../../../lib/composer-commands/confirmations.js';
import { ComposerCommandParseError } from '../../../../lib/composer-commands/parser.js';
import {
  composerCommandResultHttpStatus,
  handleComposerCommandMessage,
  isComposerCommandMessage,
} from '../../../../lib/composer-commands/router.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import { validateOrigin } from '../origin-validation.js';
import { readJsonBody } from './shared.js';

async function sendAgentMessage(id: string, message: string) {
  const agentStateDir = join(homedir(), '.overdeck', 'agents', id);
  const remoteStateFile = join(agentStateDir, 'remote-state.json');
  let isRemote = false;

  if (existsSync(remoteStateFile)) {
    try {
      const state = JSON.parse(await readFile(remoteStateFile, 'utf-8'));
      isRemote = state.location === 'remote' && Boolean(state.vmName);
    } catch {}
  }

  await messageAgent(id, message, 'dashboard:user-message');
  return isRemote ? { success: true, remote: true } : { success: true };
}

export async function handleAgentMessage(
  id: string,
  message: string,
  confirmation?: ComposerCommandConfirmationInput,
) {
  try {
    if (isComposerCommandMessage(message)) {
      let agentState;
      try {
        agentState = await Effect.runPromise(getAgentState(id));
      } catch {
        return jsonResponse({
          error: `Failed to resolve agent target: ${id}`,
          code: 'agent-resolution-failed',
        }, { status: 503 });
      }
      if (!agentState) {
        return jsonResponse({
          error: `Agent not found: ${id}`,
          code: 'agent-not-found',
        }, { status: 404 });
      }
      if (!agentState.harness) {
        return jsonResponse({
          error: `Agent harness could not be resolved: ${id}`,
          code: 'agent-harness-unresolved',
        }, { status: 503 });
      }
      const result = await handleComposerCommandMessage({
        message,
        confirmation,
        target: {
          kind: 'agent',
          id,
          harness: agentState.harness,
          cwd: agentState.workspace,
          issueId: agentState.issueId,
        },
      });
      if (result !== null) {
        return jsonResponse(result, { status: composerCommandResultHttpStatus(result) });
      }
    }
  } catch (error) {
    if (error instanceof ComposerCommandConfirmationError) {
      return jsonResponse({
        error: error.message,
        code: error.code,
      }, { status: 422 });
    }
    if (!(error instanceof ComposerCommandParseError)) throw error;
    const status = error.code === 'unknown-command' ? 404 : error.code === 'unknown-flag' ? 422 : 400;
    return jsonResponse({
      error: error.message,
      code: error.code,
      token: error.token,
      expected: error.expected,
    }, { status });
  }

  return jsonResponse(await sendAgentMessage(id, message));
}

export function validateAgentMessageOrigin(request: HttpServerRequest.HttpServerRequest) {
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) {
    return {
      ok: false as const,
      response: jsonResponse({ ok: false, error: originCheck.error }, { status: 403 }),
    };
  }
  return { ok: true as const };
}

function postAgentMessageLikeRoute(path: `/${string}`) {
  return HttpRouter.add(
    'POST',
    path,
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const originCheck = validateAgentMessageOrigin(request);
      if (!originCheck.ok) return originCheck.response;

      const params = yield* HttpRouter.params;
      const id = params['id'] ?? '';
      const body = yield* readJsonBody;

      const { message } = body as any;
      if (!message) {
        return jsonResponse({ error: 'Message required' }, { status: 400 });
      }

      return yield* Effect.promise(() => handleAgentMessage(
        id,
        message,
        composerCommandConfirmationFromBody(body as Record<string, unknown>),
      ));
    })),
  );
}

// ─── Route: POST /api/agents/:id/message ─────────────────────────────────────

export const postAgentMessageRoute = postAgentMessageLikeRoute('/api/agents/:id/message');

// ─── Route: POST /api/agents/:id/tell ────────────────────────────────────────

export const postAgentTellRoute = postAgentMessageLikeRoute('/api/agents/:id/tell');

// ─── Route: POST /api/agents/:id/poke ────────────────────────────────────────

export const postAgentPokeRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/poke',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    const { message } = body as any;
    const defaultPokeMessage =
      "You seem to have been inactive for a while. If you're stuck:\n" +
      '1. Check your current xBRIEF task with `pan task show <issue> <item-id>`\n' +
      '2. Try an alternative approach if blocked\n' +
      '3. Ask for help if needed\n\n' +
      "What's your current status?";
    const pokeMsg = message || defaultPokeMessage;
    yield* Effect.promise(() => messageAgent(id, pokeMsg));
    return jsonResponse({ success: true, message: 'Agent poked successfully' });
  })),
);
