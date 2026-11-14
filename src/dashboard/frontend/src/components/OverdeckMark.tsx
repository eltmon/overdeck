import { useEffect, useId, useState } from 'react';

/**
 * Overdeck brand mark — the "control ring": an orbit ring with a center hub
 * and one agent satellite on the ring. Monochrome (currentColor) so it follows
 * the surrounding text color like a lucide icon; the satellite is punched out
 * of the ring via a mask so it reads as a detached beacon at any size.
 *
 * `orbiting` sends the satellite around the ring, like the logo animation in
 * the Overdeck videos. The ring and hub are symmetric about the center, so
 * rotating the whole mark moves only the satellite (and its mask gap). When
 * `orbiting` turns off, the current lap finishes so the satellite comes to
 * rest at its home position instead of jumping back.
 *
 * Canonical two-tone SVG assets live in /favicon.svg and /logo/.
 */
export function OverdeckMark({ className, orbiting = false }: { className?: string; orbiting?: boolean }) {
  const maskId = useId();
  const [spinning, setSpinning] = useState(orbiting);
  useEffect(() => {
    if (orbiting) setSpinning(true);
  }, [orbiting]);

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={`${className ?? ''}${spinning ? ' motion-safe:animate-[spin_6s_linear_infinite]' : ''}`}
      onAnimationIteration={() => {
        if (!orbiting) setSpinning(false);
      }}
      data-orbiting={spinning ? 'true' : undefined}
      aria-hidden="true"
    >
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
