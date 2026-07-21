import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { messageAgent } from '../../../../lib/agents.js';
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

      return yield* Effect.promise(() => sendAgentMessage(id, message)).pipe(
        Effect.map((result) => jsonResponse(result)),
      );
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
