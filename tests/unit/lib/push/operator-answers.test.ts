import { beforeEach, describe, expect, it } from 'vitest';

import {
  noteOperatorAnswer,
  operatorAnsweredBetween,
  resetOperatorAnswers,
} from '../../../../src/lib/push/operator-answers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  resetOperatorAnswers();
});

describe('operator answer notes (PAN-5111)', () => {
  it('matches a note inside the window only', () => {
    noteOperatorAnswer('auq:t1', 1000);
    expect(operatorAnsweredBetween('auq:t1', 500, 1500, 1000)).toBe(true);
    expect(operatorAnsweredBetween('auq:t1', 1001, 2000, 1000)).toBe(false);
    expect(operatorAnsweredBetween('auq:other', 0, 2000, 1000)).toBe(false);
  });

  it('never consumes a note', () => {
    noteOperatorAnswer('auq:t1', 1000);
    expect(operatorAnsweredBetween('auq:t1', 500, 1500, 1000)).toBe(true);
    expect(operatorAnsweredBetween('auq:t1', 500, 1500, 1000)).toBe(true);
  });

  it('forgets notes older than 24 h', () => {
    noteOperatorAnswer('auq:t1', 1000);
    expect(operatorAnsweredBetween('auq:t1', 0, Number.MAX_SAFE_INTEGER, 1000 + DAY_MS + 1)).toBe(false);
  });

  it('ignores an empty key', () => {
    noteOperatorAnswer('', 1000);
    expect(operatorAnsweredBetween('', 0, Number.MAX_SAFE_INTEGER, 1000)).toBe(false);
  });

  it('keeps at most 10 times per key, dropping the oldest', () => {
    for (let t = 1; t <= 11; t++) noteOperatorAnswer('auq:t1', t * 100);
    expect(operatorAnsweredBetween('auq:t1', 100, 100, 1100)).toBe(false);
    expect(operatorAnsweredBetween('auq:t1', 200, 200, 1100)).toBe(true);
  });

  it('evicts the oldest key when the 501st key arrives', () => {
    for (let i = 0; i < 501; i++) noteOperatorAnswer(`auq:k${i}`, 1000);
    expect(operatorAnsweredBetween('auq:k0', 0, Number.MAX_SAFE_INTEGER, 1000)).toBe(false);
    expect(operatorAnsweredBetween('auq:k1', 0, Number.MAX_SAFE_INTEGER, 1000)).toBe(true);
    expect(operatorAnsweredBetween('auq:k500', 0, Number.MAX_SAFE_INTEGER, 1000)).toBe(true);
  });
});
