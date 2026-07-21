import { useId } from 'react';

/**
 * Overdeck brand mark — the "control ring": an orbit ring with a center hub
 * and one agent satellite on the ring. Monochrome (currentColor) so it follows
 * the surrounding text color like a lucide icon; the satellite is punched out
 * of the ring via a mask so it reads as a detached beacon at any size.
 *
 * Canonical two-tone SVG assets live in /favicon.svg and /logo/.
 */
export function OverdeckMark({ className }: { className?: string }) {
  const maskId = useId();
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <mask id={maskId}>
        <rect width="32" height="32" fill="white" />
        <circle cx="26.8" cy="9.2" r="5.4" fill="black" />
      </mask>
      <circle cx="16" cy="16" r="12.5" stroke="currentColor" strokeWidth="4" mask={`url(#${maskId})`} />
      <circle cx="16" cy="16" r="4.5" fill="currentColor" />
      <circle cx="26.8" cy="9.2" r="3.4" fill="currentColor" />
    </svg>
  );
}
