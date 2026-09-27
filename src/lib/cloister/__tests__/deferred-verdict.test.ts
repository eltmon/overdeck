import { describe, expect, it } from 'vitest';

import { capDeferredNotes, DEFERRED_VERDICT_NOTES_MAX_BYTES } from '../deferred-verdict.js';

describe('capDeferredNotes (PAN-4263)', () => {
  it('keeps notes that fit', () => {
    expect(capDeferredNotes('short')).toBe('short');
  });

  it('truncates on a character boundary under the byte cap and says so', () => {
    const notes = '€'.repeat(DEFERRED_VERDICT_NOTES_MAX_BYTES);
    const capped = capDeferredNotes(notes);

    expect(Buffer.byteLength(capped, 'utf-8')).toBeLessThanOrEqual(DEFERRED_VERDICT_NOTES_MAX_BYTES);
    expect(capped.endsWith('[notes truncated by deferred-verdict replay]')).toBe(true);
    expect(capped).not.toContain('�');
  });
});
