/**
 * `POST /api/linked-conversations/open-in-editor { conversation, editor }`
 * (PAN-4650 WI-20, D-4650-18), admin. Launches the local editor in
 * remote-SSH mode at the owner's checkout. The working directory comes from
 * the cached shared row, never from the request.
 */
import { spawn } from 'node:child_process';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { parseLinkedConversationName } from '@overdeck/contracts';

import { getLink, type MachineLink } from '../../../lib/anywhere/link-store.js';
import { getLinkedConversation, type LinkedConversationRecord } from '../../../lib/overdeck/linked-conversations.js';
import { getSshMachineByLinkId, type SshMachineRecord } from '../../../lib/anywhere/ssh/machine-store.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { REMOTE_EDITOR_UNSUPPORTED_HINT, resolveRemoteEditorLaunch } from '../services/open-remote.js';

export interface LinkedOpenDeps {
  getLink: (idOrEnvOrLabel: string) => Promise<MachineLink | null>;
  getLinked: (environmentId: string, name: string) => LinkedConversationRecord | null;
  getSshMachine: (linkId: string) => Promise<SshMachineRecord | null>;
  launch: (command: string, args: string[]) => void;
}

const defaultDeps: LinkedOpenDeps = {
  getLink,
  getLinked: getLinkedConversation,
  getSshMachine: getSshMachineByLinkId,
  launch: (command, args) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', (error) => console.warn(`[open-in-editor] ${command} failed: ${error.message}`));
    child.unref();
  },
};

export async function handleLinkedOpenInEditor(body: Record<string, unknown>, overrides: Partial<LinkedOpenDeps> = {}): Promise<HttpServerResponse.HttpServerResponse> {
  const deps = { ...defaultDeps, ...overrides };
  const parsed = typeof body['conversation'] === 'string' ? parseLinkedConversationName(body['conversation']) : null;
  if (!parsed || typeof body['editor'] !== 'string') {
    return jsonResponse({ error: 'body must be { conversation: "@<machine>/<name>", editor }' }, { status: 400 });
  }
  const link = await deps.getLink(parsed.target);
  const record = link && link.revokedAt === null ? deps.getLinked(link.environmentId, parsed.name) : null;
  if (!link || !record) return jsonResponse({ error: 'No such linked conversation', code: 'not-found' }, { status: 404 });
  // An absolute path only: the cwd is a positional editor argument, so a shared value starting with `-` must never become a flag.
  if (!record.row.cwd?.startsWith('/')) return jsonResponse({ error: 'The owner did not share an absolute working directory', code: 'no-cwd' }, { status: 409 });
  const sshMachine = await deps.getSshMachine(link.id);
  const launch = resolveRemoteEditorLaunch({ editor: body['editor'], link, cwd: record.row.cwd, sshDestination: sshMachine?.destination ?? null });
  if ('error' in launch) {
    return launch.error === 'editor-unsupported'
      ? jsonResponse({ error: REMOTE_EDITOR_UNSUPPORTED_HINT, code: 'editor-unsupported' }, { status: 400 })
      : jsonResponse({ error: `${link.label} has no SSH host (not an SSH machine and no tailnet route)`, code: 'no-ssh-host' }, { status: 409 });
  }
  deps.launch(launch.command, launch.args);
  return jsonResponse({ ok: true, commandLine: [launch.command, ...launch.args].join(' ') });
}

const linkedOpenRoute = HttpRouter.add(
  'POST',
  '/api/linked-conversations/open-in-editor',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = rejectUnsafeDashboardMutationRequest(request);
    if (refused) return refused;
    const text = yield* request.text;
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return jsonResponse({ error: 'body is not JSON' }, { status: 400 });
    }
    return yield* Effect.promise(() => handleLinkedOpenInEditor(body));
  }),
);

export const linkedOpenRouteLayer = Layer.mergeAll(linkedOpenRoute);
