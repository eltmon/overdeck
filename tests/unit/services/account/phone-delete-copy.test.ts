import { describe, expect, it } from 'vitest';
import { DELETE_STATEMENT as PHONE_DELETE_STATEMENT, DELETION_STARTED_MESSAGE as PHONE_DELETION_STARTED_MESSAGE } from '../../../../apps/mobile/src/shell/accountDeletionCopy.ts';
import { DELETE_STATEMENT } from '../../../../services/account/src/account-page/page.ts';
import { DELETION_STARTED_MESSAGE } from '../../../../services/account/src/account-page/actions.ts';

describe('phone account-deletion copy parity (PAN-5107)', () => {
  it('DELETE_STATEMENT matches the account page', () => {
    expect(PHONE_DELETE_STATEMENT).toBe(DELETE_STATEMENT);
  });

  it('DELETION_STARTED_MESSAGE matches the account page actions', () => {
    expect(PHONE_DELETION_STARTED_MESSAGE).toBe(DELETION_STARTED_MESSAGE);
  });
});
