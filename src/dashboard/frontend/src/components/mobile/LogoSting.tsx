/**
 * The Overdeck logo sting (PAN-5208 FR-10..FR-12, D-9..D-13): the four brand beats from the video
 * recipe (the ring draws itself, the hub pops, the satellite arcs home, the wordmark unmasks),
 * played as an overlay over the already-mounted app, at most once per `sessionStorage` lifetime.
 *
 * - The overlay never gates content: the app beneath renders and fetches from the first frame.
 * - The fade starts at the later of `MIN_STING_MS` and the moment `ready` first turns true, and
 *   never later than `STING_MS`. A tap starts it at once.
 * - Under `prefers-reduced-motion: reduce` nothing animates: the settled lockup shows for
 *   `REDUCED_HOLD_MS` and is removed with no fade.
 * - Animation uses the Web Animations API; where `Element.prototype.animate` is missing the parts
 *   render settled. Removal is driven by `setTimeout` only, never by animation events.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { MARK_CLASSES } from './brand';

export const LOGO_STING_KEY = 'overdeck.logoSting.played';
/** The ring is drawn and the hub has popped. */
export const MIN_STING_MS = 1300;
/** The whole sting; the fade starts here at the latest. */
export const STING_MS = 2300;
export const FADE_MS = 250;
export const REDUCED_HOLD_MS = 600;

const EASE_OUT_QUAD = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
const EASE_OUT_CUBIC = 'cubic-bezier(0.215, 0.61, 0.355, 1)';
const EASE_OUT_SINE = 'cubic-bezier(0.39, 0.575, 0.565, 1)';

/** Sampled from the recipe's satellite path `M -16.8 -11.2 Q -7.76 -8.91 0 0`. */
const SATELLITE_ARC = ['-16.8px,-11.2px', '-12.36px,-9.64px', '-8.08px,-7.26px', '-3.96px,-4.04px', '0px,0px'];

type Phase = 'playing' | 'fading' | 'done';

function hasPlayed(): boolean {
  try {
    return sessionStorage.getItem(LOGO_STING_KEY) === '1';
  } catch {
    return false;
  }
}

function markPlayed(): void {
  try {
    sessionStorage.setItem(LOGO_STING_KEY, '1');
  } catch {
    // Storage unavailable: the sting may play again on the next load.
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface StingParts {
  ring: RefObject<SVGCircleElement | null>;
  hub: RefObject<SVGCircleElement | null>;
  satellite: RefObject<SVGCircleElement | null>;
  satelliteGroup: RefObject<SVGGElement | null>;
  wordmark: RefObject<HTMLSpanElement | null>;
}

/** Starts the D-12 animations; returns them so unmount can cancel them. */
function animateParts(parts: StingParts): Animation[] {
  const run = (el: Element | null, keyframes: Keyframe[], delay: number, duration: number, easing: string): Animation | null =>
    el && typeof el.animate === 'function' ? el.animate(keyframes, { delay, duration, easing, fill: 'both' }) : null;
  return [
    run(parts.ring.current, [{ strokeDashoffset: '1' }, { strokeDashoffset: '0' }], 200, 750, EASE_OUT_QUAD),
    run(parts.hub.current, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], 750, 450, EASE_OUT_CUBIC),
    run(parts.satellite.current, [{ opacity: 0 }, { opacity: 1 }], 1300, 250, EASE_OUT_SINE),
    run(parts.satelliteGroup.current, SATELLITE_ARC.map((xy) => ({ transform: `translate(${xy})` })), 1300, 950, EASE_OUT_CUBIC),
    run(parts.wordmark.current, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], 1250, 850, EASE_OUT_CUBIC),
  ].filter((animation): animation is Animation => animation !== null);
}

export function LogoSting({ ready, skip = false }: { ready: boolean; skip?: boolean }) {
  // Pure read: safe under React.StrictMode's double initializer call. The mount effect writes.
  const [initialPhase] = useState<Phase>(() => (skip || hasPlayed() ? 'done' : 'playing'));
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const reduced = useMemo(prefersReducedMotion, []);
  const startRef = useRef(0);
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ring = useRef<SVGCircleElement>(null);
  const hub = useRef<SVGCircleElement>(null);
  const satellite = useRef<SVGCircleElement>(null);
  const satelliteGroup = useRef<SVGGElement>(null);
  const wordmark = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    markPlayed();
    if (initialPhase !== 'playing') return;
    startRef.current = Date.now();
    if (reduced) {
      const hold = setTimeout(() => setPhase('done'), REDUCED_HOLD_MS);
      return () => clearTimeout(hold);
    }
    const animations = animateParts({ ring, hub, satellite, satelliteGroup, wordmark });
    const cap = setTimeout(() => setPhase((p) => (p === 'playing' ? 'fading' : p)), STING_MS);
    return () => {
      clearTimeout(cap);
      if (readyTimerRef.current !== null) clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
      for (const animation of animations) animation.cancel();
    };
    // Mount-only: the phase the sting started in never changes.
  }, [initialPhase, reduced]);

  useEffect(() => {
    if (!ready || reduced || initialPhase !== 'playing' || readyTimerRef.current !== null) return;
    const wait = Math.max(0, MIN_STING_MS - (Date.now() - startRef.current));
    readyTimerRef.current = setTimeout(() => setPhase((p) => (p === 'playing' ? 'fading' : p)), wait);
  }, [ready, reduced, initialPhase]);

  useEffect(() => {
    if (phase !== 'fading') return;
    const fade = setTimeout(() => setPhase('done'), FADE_MS);
    return () => clearTimeout(fade);
  }, [phase]);

  if (phase === 'done') return null;

  return (
    <div
      data-component="logo-sting"
      data-state={phase}
      aria-hidden="true"
      onPointerDown={() => {
        if (phase === 'playing') setPhase(reduced ? 'done' : 'fading');
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background transition-opacity"
      style={{ opacity: phase === 'fading' ? 0 : 1, transitionDuration: `${FADE_MS}ms` }}
    >
      <span className="inline-flex items-center gap-3">
        <svg viewBox="0 0 40 40" fill="none" className="h-16 w-16 shrink-0">
          <g transform="rotate(-90 20 20)">
            <circle
              ref={ring}
              cx="20"
              cy="20"
              r="12.5"
              strokeWidth="4"
              fill="none"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={0}
              className={MARK_CLASSES.ring}
            />
          </g>
          <circle
            ref={hub}
            cx="20"
            cy="20"
            r="4.5"
            className={MARK_CLASSES.hub}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          />
          <g ref={satelliteGroup}>
            <circle ref={satellite} cx="30.8" cy="13.2" r="3.4" className={MARK_CLASSES.satellite} />
          </g>
        </svg>
        <span ref={wordmark} className={`font-display text-3xl font-[600] leading-none tracking-[0.02em] ${MARK_CLASSES.wordmark}`}>
          Overdeck
        </span>
      </span>
    </div>
  );
}
