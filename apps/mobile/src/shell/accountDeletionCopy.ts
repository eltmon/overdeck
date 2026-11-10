/**
 * Phone account-deletion copy (PRD PAN-5107 WI-1).
 *
 * No imports: DELETE_STATEMENT and DELETION_STARTED_MESSAGE are duplicated here from
 * services/account/src/account-page/page.ts and actions.ts and pinned equal by a parity test
 * (tests/unit/services/account/phone-delete-copy.test.ts), because services/account has no
 * contracts dependency and sharing a module would change Worker source, which the issue forbids.
 */
export const DELETE_STATEMENT =
  'Deleting your account signs out every device, removes your machines from the directory and deletes all of your hosted data within 24 hours.';

export const DELETION_STARTED_MESSAGE = 'Your account is being deleted.';

export const DELETE_IRREVERSIBLE = "This can't be undone.";

export const DELETE_CONFIRM_WORD = 'DELETE';

export const FINISH_ON_WEB_MESSAGE = 'This phone is signed out. Finish deleting your account on the web.';
