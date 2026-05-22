/**
 * Harness templating for context layers (PAN-1201).
 *
 * A single canonical markdown source per context layer renders to N
 * harness-specific outputs. Harness-specific divergence is expressed with
 * Mustache-style block markers:
 *
 *   {{#harness:claude}} … {{/harness:claude}}
 *   {{#harness:pi}}     … {{/harness:pi}}
 *
 * Blocks may be stacked to mark one span for several harnesses (union):
 *
 *   {{#harness:claude}}{{#harness:pi}}
 *   Shared: never commit secrets.
 *   {{/harness:claude}}{{/harness:pi}}
 *
 * Rendering for harness H keeps a span when it is covered by no harness
 * marker (always-on) or by a marker naming H; every marker is stripped from
 * the output. Markers for an unrecognised harness name are still parsed —
 * `pan context validate` only warns about them — so a layer can be authored
 * for a harness Panopticon does not ship an adapter for yet.
 */

import type { Harness } from '@panctl/contracts';

/** Short marker name used in `{{#harness:<name>}}` blocks. */
export type HarnessMarker = 'claude' | 'pi';

/** Maps a Panopticon {@link Harness} to its templating marker name. */
export const HARNESS_MARKERS: Record<Harness, HarnessMarker> = {
  'claude-code': 'claude',
  pi: 'pi',
};

/** Marker names Panopticon ships an adapter for in v1. */
export const KNOWN_HARNESS_MARKERS: ReadonlySet<string> = new Set<HarnessMarker>(['claude', 'pi']);

/** Matches an open `{{#harness:x}}` or close `{{/harness:x}}` marker. */
const MARKER_RE = /\{\{([#/])harness:([a-zA-Z0-9_-]+)\}\}/g;

/**
 * Render a canonical layer body for a single harness.
 *
 * Strips every `{{#harness:*}}` / `{{/harness:*}}` marker and drops the spans
 * that are not covered by the target harness. Runs of 3+ blank lines left by
 * removed spans collapse to a single blank line so output stays tidy.
 */
export function renderForHarness(content: string, harness: Harness): string {
  const target = HARNESS_MARKERS[harness];
  const openCounts = new Map<string, number>();
  let out = '';
  let lastIndex = 0;

  const emit = (text: string): void => {
    // The "covering set" is every harness name with a currently-open marker.
    // Empty → always-on. Counters (not a stack) make overlapping, non-nested
    // stacked blocks like {{#claude}}{{#pi}}…{{/claude}}{{/pi}} resolve right.
    let covered = false;
    let anyOpen = false;
    for (const [name, count] of openCounts) {
      if (count > 0) {
        anyOpen = true;
        if (name === target) covered = true;
      }
    }
    if (!anyOpen || covered) out += text;
  };

  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(content)) !== null) {
    emit(content.slice(lastIndex, m.index));
    const [, kind, name] = m;
    const delta = kind === '#' ? 1 : -1;
    openCounts.set(name, (openCounts.get(name) ?? 0) + delta);
    lastIndex = m.index + m[0].length;
  }
  emit(content.slice(lastIndex));

  return out.replace(/\n{3,}/g, '\n\n');
}

/** A problem found by {@link validateTemplate}. */
export interface TemplateIssue {
  severity: 'error' | 'warning';
  message: string;
}

/** Result of linting a context-layer template. */
export interface TemplateValidation {
  ok: boolean;
  issues: TemplateIssue[];
}

/**
 * Lint a context-layer template for malformed harness blocks.
 *
 * Errors: an unclosed `{{#harness:x}}` or a stray `{{/harness:x}}` with no
 * matching open. Warnings: a marker naming a harness Panopticon has no
 * adapter for (allowed for forward compatibility, surfaced so typos —
 * `{{#harness:clade}}` — do not pass silently).
 */
export function validateTemplate(content: string): TemplateValidation {
  const issues: TemplateIssue[] = [];
  const openCounts = new Map<string, number>();
  const seen = new Set<string>();

  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(content)) !== null) {
    const [, kind, name] = m;
    seen.add(name);
    if (kind === '#') {
      openCounts.set(name, (openCounts.get(name) ?? 0) + 1);
    } else {
      const next = (openCounts.get(name) ?? 0) - 1;
      openCounts.set(name, next);
      if (next < 0) {
        issues.push({
          severity: 'error',
          message: `stray closing marker {{/harness:${name}}} with no matching {{#harness:${name}}}`,
        });
      }
    }
  }

  for (const [name, count] of openCounts) {
    if (count > 0) {
      issues.push({
        severity: 'error',
        message: `unclosed block: {{#harness:${name}}} opened ${count} time(s) without a matching {{/harness:${name}}}`,
      });
    }
  }

  for (const name of seen) {
    if (!KNOWN_HARNESS_MARKERS.has(name)) {
      issues.push({
        severity: 'warning',
        message: `unknown harness "${name}" — Panopticon ships adapters for: ${[...KNOWN_HARNESS_MARKERS].join(', ')}`,
      });
    }
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}
