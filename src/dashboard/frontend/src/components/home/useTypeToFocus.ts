/**
 * PAN-4280 (WI-10, FR-4) — "type and go": a printable key pressed anywhere on
 * the page body focuses the Home composer input and the character lands in
 * it. Registered on the capture phase so it runs before App.tsx's bubble-phase
 * global shortcuts (the 'g' lens chord, '/' for search) can claim the key —
 * capture always precedes bubble regardless of listener registration order,
 * unlike two same-phase listeners on the same node. It stops the event
 * outright and inserts the character itself through the input's native value
 * setter (dispatching `input` so React's onChange fires), instead of letting
 * the key bubble to the newly focused element, because moving focus alone
 * does not un-claim a keydown a same-tick sibling listener already consumed.
 */
import { useEffect, type RefObject } from 'react';

const NATIVE_INPUT_VALUE_SETTER = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

export function useTypeToFocus(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.length !== 1) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const active = document.activeElement;
      if (active !== document.body && active !== null) return;
      if (document.querySelector('[role="dialog"]')) return;
      const input = ref.current;
      if (!input) return;
      e.preventDefault();
      e.stopPropagation();
      input.focus();
      NATIVE_INPUT_VALUE_SETTER.call(input, input.value + e.key);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [ref]);
}
