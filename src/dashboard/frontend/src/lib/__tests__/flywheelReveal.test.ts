import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  consumePendingReveal,
  requestRevealOpenQuestions,
  subscribeRevealOpenQuestions,
} from '../flywheelReveal';

afterEach(() => {
  consumePendingReveal();
});

describe('flywheel reveal signal', () => {
  it('keeps a reveal pending until it is consumed once', () => {
    requestRevealOpenQuestions();

    expect(consumePendingReveal()).toBe(true);
    expect(consumePendingReveal()).toBe(false);
  });

  it('notifies every subscribed listener', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeRevealOpenQuestions(first);
    const unsubscribeSecond = subscribeRevealOpenQuestions(second);

    requestRevealOpenQuestions();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('stops notifying a listener after it unsubscribes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRevealOpenQuestions(listener);
    unsubscribe();

    requestRevealOpenQuestions();

    expect(listener).not.toHaveBeenCalled();
  });
});
