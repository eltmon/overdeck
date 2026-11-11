/** PAN-5091: the in-memory record of deliberate conversation stops. */
import { afterEach, describe, expect, it } from 'vitest';

import { _resetConversationStopMarksForTests, conversationStoppedSince, recordConversationStop } from '../conversation-stop-marks.js';

const HOUR = 60 * 60_000;

afterEach(() => _resetConversationStopMarksForTests());

describe('conversation stop marks', () => {
  it('answers true only for a stop at or after the given time', () => {
    recordConversationStop('a', 1_000);
    expect(conversationStoppedSince('a', 1_000)).toBe(true);
    expect(conversationStoppedSince('a', 500)).toBe(true);
    expect(conversationStoppedSince('a', 1_001)).toBe(false);
    expect(conversationStoppedSince('b', 0)).toBe(false);
  });

  it('keeps the latest stop of a conversation', () => {
    recordConversationStop('a', 1_000);
    recordConversationStop('a', 5_000);
    expect(conversationStoppedSince('a', 4_000)).toBe(true);
  });

  it('drops marks older than a day when a new one is written', () => {
    recordConversationStop('old', 0);
    recordConversationStop('new', 25 * HOUR);
    expect(conversationStoppedSince('old', 0)).toBe(false);
    expect(conversationStoppedSince('new', 25 * HOUR)).toBe(true);
  });
});
