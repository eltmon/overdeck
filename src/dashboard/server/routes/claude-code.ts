/**
 * `GET /api/claude-code/status` and `POST /api/claude-code/upgrade` (PAN-4359).
 * The upgrade command comes only from the server-side upgrade plan — the
 * request body is never consumed into the command that runs.
 */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { getClaudeCodeStatus } from '../../../lib/claude-code/status.js';
import { createSession, sessionExists } from '../../../lib/tmux.js';
import { shellQuote, shellQuoteArg } from '../../../lib/shell-quote.js';
import { validateOrigin } from './origin-validation.js';

const UPGRADE_SESSION_NAME = 'claude-code-upgrade';

function rejectInvalidOrigin(request: HttpServerRequest.HttpServerRequest): ReturnType<typeof jsonResponse> | null {
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) {
    return jsonResponse({ error: originCheck.error }, { status: 403 });
  }
  return null;
}

// ─── Route: GET /api/claude-code/status ────────────────────────────────────

const getClaudeCodeStatusRoute = HttpRouter.add(
  'GET',
  '/api/claude-code/status',
  httpHandler(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, 'http://localhost');
      const refresh = url.searchParams.get('refresh') === '1';
      const status = yield* Effect.promise(() => getClaudeCodeStatus({ refresh }));
      return jsonResponse(status);
    }),
  ),
);

// ─── Route: POST /api/claude-code/upgrade ──────────────────────────────────

/**
 * Builds the upgrade session command from the plan's own argv only — never
 * from client input. Re-reads the version after the upgrade so the operator
 * sees whether it took, and waits for Enter so the output stays on screen.
 */
function buildUpgradeCommand(binaryPath: string, argv: string[]): string {
  const upgradeCommand = argv.map(shellQuoteArg).join(' ');
  return (
    `${upgradeCommand}; code=$?; echo; ${shellQuote(binaryPath)} --version; ` +
    `echo "Upgrade finished (exit $code). New launches use this Claude Code; running sessions keep their current one."; ` +
    `printf 'Press Enter to close. '; read _`
  );
}

const postClaudeCodeUpgradeRoute = HttpRouter.add(
  'POST',
  '/api/claude-code/upgrade',
  httpHandler(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const originError = rejectInvalidOrigin(request);
      if (originError) return originError;

      const status = yield* Effect.promise(() => getClaudeCodeStatus({ refresh: true }));

      if (!status.found || !status.upgrade?.runnable || !status.upgrade.argv || !status.binaryPath) {
        return jsonResponse(
          {
            error: status.found
              ? 'Overdeck cannot run this upgrade automatically; run the command yourself.'
              : 'Claude Code was not found on this machine.',
            command: status.upgrade?.display ?? null,
          },
          { status: 400 },
        );
      }

      if (status.outdated === false && status.version !== null) {
        return jsonResponse(
          { error: 'Claude Code already satisfies every configured model', command: status.upgrade.display },
          { status: 400 },
        );
      }

      const exists = yield* sessionExists(UPGRADE_SESSION_NAME);
      if (exists) {
        return jsonResponse({ sessionName: UPGRADE_SESSION_NAME, alreadyRunning: true }, { status: 409 });
      }

      const command = buildUpgradeCommand(status.binaryPath, status.upgrade.argv);
      yield* createSession(UPGRADE_SESSION_NAME, homedir(), command, {
        env: { PATH: `${dirname(status.binaryPath)}:${process.env.PATH ?? ''}` },
      });

      return jsonResponse({ sessionName: UPGRADE_SESSION_NAME, command: status.upgrade.display });
    }),
  ),
);

export const claudeCodeRouteLayer = Layer.mergeAll(
  getClaudeCodeStatusRoute,
  postClaudeCodeUpgradeRoute,
);
