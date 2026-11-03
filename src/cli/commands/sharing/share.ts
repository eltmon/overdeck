/**
 * `pan share <conversation>` — share a conversation by link (PRD PAN-4480 WI-3, FR-1–FR-3, D-3).
 *
 * Resolves the conversation id or name, calls `POST /api/shares` on the running dashboard with the
 * internal token and prints the join link, the join code and both join commands. It never starts a
 * dashboard: the host hub must run in the full `pan up` stack. The host token never reaches the CLI.
 */
import type { ShareView } from '@overdeck/contracts';

import { formatShareCode } from '../../../lib/sharing/share-code.js';
import { defaultAccountIo, type AccountIo } from '../account/shared.js';
import { callDashboard as defaultCallDashboard, errorText, isDashboardUnreachable } from '../dashboard-call.js';

export interface ShareOptions {
  json?: boolean;
}

export interface ShareDeps {
  callDashboard?: typeof defaultCallDashboard;
  resolveConversation?: (ref: string) => { name: string } | null;
}

export async function shareCommand(
  ref: string,
  options: ShareOptions,
  io: AccountIo = defaultAccountIo,
  deps: ShareDeps = {},
): Promise<void> {
  // Loaded here so a test that injects a resolver never opens the conversations database.
  const resolveConversation = deps.resolveConversation ?? (await import('../handoff-shared.js')).resolveConversation;
  const conversation = resolveConversation(ref);
  if (!conversation) {
    io.err(`No conversation matches ${ref}. Use the number from /conv/<id> or the conversation name.`);
    return io.exit(1);
  }

  let response: Response;
  try {
    response = await (deps.callDashboard ?? defaultCallDashboard)('/api/shares', {
      method: 'POST',
      body: { conversationName: conversation.name },
    });
  } catch (error) {
    if (!isDashboardUnreachable(error)) throw error;
    io.err('The Overdeck dashboard is not running. Start it with pan up, then run pan share again.');
    return io.exit(1);
  }
  if (response.status !== 200 && response.status !== 201) {
    io.err(`Cannot share ${conversation.name}: ${await errorText(response)}`);
    return io.exit(1);
  }

  const view = (await response.json()) as ShareView;
  if (options.json) {
    io.out(JSON.stringify(view));
    return;
  }

  const code = formatShareCode(view.shortCode);
  io.out(
    response.status === 201
      ? `Shared conversation ${conversation.name}.`
      : `Conversation ${conversation.name} is already shared.`,
  );
  io.out(`Link:      ${view.joinUrl}`);
  io.out(`Join code: ${code}`);
  io.out(`Viewers join with: pan join ${code}`);
  io.out(`No Overdeck installed? npx @overdeck/core join ${code}`);
  io.out('Let people in from the share dialog in the dashboard (⋮ → Share this conversation).');
}
