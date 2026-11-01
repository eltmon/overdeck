/**
 * Asking the overdeck.ai directory for a webhook inbox (PRD PAN-2356 WI-20, D-2356-13).
 *
 * `inbox-create` answers once with the inbox's public handle and its URL, which carries the
 * secret and is shown to the operator once. A free plan answers `plan_required`.
 */
import { randomBytes } from 'node:crypto';
import type { DirectoryToMachineFrame, MachineToDirectoryFrame } from '@overdeck/contracts';

export const INBOX_CREATE_TIMEOUT_MS = 10_000;
export const SIGNED_OUT_MESSAGE = 'Sign in with pan account login to hold events in the overdeck.ai inbox';

export interface InboxDirectoryPort {
  isOnline(): boolean;
  send(frame: MachineToDirectoryFrame): boolean;
  on<T extends DirectoryToMachineFrame['type']>(type: T, handler: (frame: Extract<DirectoryToMachineFrame, { type: T }>) => void): () => void;
}

export class DirectoryInboxError extends Error {}

export function requestInbox(directory: InboxDirectoryPort | null, timeoutMs = INBOX_CREATE_TIMEOUT_MS): Promise<{ inboxId: string; url: string }> {
  if (!directory?.isOnline()) return Promise.reject(new DirectoryInboxError(SIGNED_OUT_MESSAGE));
  const requestId = randomBytes(8).toString('hex');
  return new Promise((resolve, reject) => {
    const offs: Array<() => void> = [];
    const done = (outcome: { inboxId: string; url: string } | Error) => {
      clearTimeout(timer);
      for (const off of offs) off();
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    };
    const timer = setTimeout(() => done(new DirectoryInboxError('The overdeck.ai directory did not answer the inbox request')), timeoutMs);
    offs.push(
      directory.on('inbox-created', (frame) => {
        if (frame.requestId === requestId) done({ inboxId: frame.inboxId, url: frame.url });
      }),
      directory.on('error', (frame) => {
        if (frame.requestId === requestId) done(new DirectoryInboxError(frame.message));
      }),
    );
    if (!directory.send({ type: 'inbox-create', requestId })) done(new DirectoryInboxError(SIGNED_OUT_MESSAGE));
  });
}
