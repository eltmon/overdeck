import {
  COMPOSER_COMMAND_MANIFEST,
  getHarnessBehavior,
} from '@overdeck/contracts';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { resolvePolicy } from '../../../lib/composer-commands/policy.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';

export const COMMANDS_API_HARNESSES = [
  'claude-code',
  'codex',
  'ohmypi',
  'acp',
] as const;

export type CommandsApiHarness = typeof COMMANDS_API_HARNESSES[number];

const OVERDECK_COMMANDS = COMPOSER_COMMAND_MANIFEST.map(entry => {
  const policy = resolvePolicy(entry.path);
  return {
    ...entry,
    mode: policy.mode,
    safety: policy.safety,
  };
});

const COMMAND_PAYLOADS = Object.fromEntries(
  COMMANDS_API_HARNESSES.map(harness => [
    harness,
    {
      harness,
      overdeck: OVERDECK_COMMANDS,
      native: getHarnessBehavior(harness).nativeCommands ?? [],
    },
  ]),
) as Record<CommandsApiHarness, {
  harness: CommandsApiHarness;
  overdeck: typeof OVERDECK_COMMANDS;
  native: NonNullable<ReturnType<typeof getHarnessBehavior>['nativeCommands']>;
}>;

export function getCommandsPayload(harness: CommandsApiHarness) {
  return COMMAND_PAYLOADS[harness];
}

export function isCommandsApiHarness(value: string): value is CommandsApiHarness {
  return COMMANDS_API_HARNESSES.includes(value as CommandsApiHarness);
}

export function resolveCommandsRequest(harness: string | null) {
  const requestedHarness = harness ?? 'claude-code';
  if (!isCommandsApiHarness(requestedHarness)) {
    return {
      ok: false as const,
      error: `Unknown harness "${requestedHarness}". Expected one of: ${COMMANDS_API_HARNESSES.join(', ')}.`,
      accepted: COMMANDS_API_HARNESSES,
    };
  }
  return {
    ok: true as const,
    payload: getCommandsPayload(requestedHarness),
  };
}

const getCommandsRoute = HttpRouter.add(
  'GET',
  '/api/commands',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const harness = new URL(request.url, 'http://localhost').searchParams.get('harness');
    const result = resolveCommandsRequest(harness);
    if (!result.ok) {
      return jsonResponse({
        error: result.error,
        accepted: result.accepted,
      }, { status: 400 });
    }
    return jsonResponse(result.payload);
  })),
);

export const commandsRouteLayer = Layer.mergeAll(getCommandsRoute);
