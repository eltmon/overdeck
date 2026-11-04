/**
 * `pan account logout`: revoke this machine's device on the account service and delete the local
 * token file (PRD PAN-4330 W-6, D-10). Touches only account.json — never vault/ or environment-id.json.
 */
import { revokeDevice } from '../../../lib/account/client.js';
import { readAccount, removeAccount } from '../../../lib/account/store.js';
import { type AccountIo, defaultAccountIo } from './shared.js';

export interface LogoutDeps {
  fetch?: typeof fetch;
}

export async function logoutCommand(options: Record<string, never> = {}, io: AccountIo = defaultAccountIo, deps: LogoutDeps = {}): Promise<void> {
  void options;
  let record;
  try {
    record = await readAccount();
  } catch (error) {
    io.err((error as Error).message);
    return io.exit(1);
  }

  if (!record) {
    io.out('Not signed in.');
    return;
  }

  const result = await revokeDevice(record.baseUrl, record.accessToken, record.deviceId, { fetch: deps.fetch });

  if (result.ok) {
    await removeAccount();
    io.out("Signed out. This machine's device token was revoked.");
    return;
  }

  await removeAccount();
  io.err(`Signed out locally, but could not revoke the device on ${record.baseUrl}: ${result.detail}. Revoke it from another signed-in machine or ask the operator.`);
  return io.exit(1);
}
