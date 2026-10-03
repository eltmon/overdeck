const PANE_ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const COMPOSER_TOP_BOUNDARY = /^\s*[─━═]{6,}/;

export interface PaneViewport {
  text: string;
  cursorY: number;
}

export type ComposerPayloadPresence = 'present' | 'absent' | 'unproven';

export function deliveryVerifyLine(content: string): string {
  const lines = content.split('\n');
  return ([...lines].reverse().find(line => line.trim().length >= 3) ?? lines[lines.length - 1])?.trim() ?? '';
}

/**
 * The cursor-anchored active-composer region of a pane: the rows between the
 * composer's top border (if any) and the cursor row, ANSI-stripped. Returns
 * null when the composer cannot be anchored (blank pane or unreadable cursor).
 * Exported so delivery-verification callers can match against the composer
 * only — never the transcript scrollback above it.
 */
export function activeComposerRegion(viewport: PaneViewport): string | null {
  const lines = viewport.text
    .replace(PANE_ANSI_PATTERN, '')
    .split('\n')
    .map(line => line.replace(/\s+$/g, ''));
  if (lines.every(line => line.trim() === '')) return null;
  if (viewport.cursorY < 0 || viewport.cursorY >= lines.length) return null;

  let start = viewport.cursorY;
  for (let index = viewport.cursorY; index >= 0; index -= 1) {
    if (COMPOSER_TOP_BOUNDARY.test(lines[index]!)) {
      start = index + 1;
      break;
    }
  }
  return lines.slice(start, viewport.cursorY + 1).join('\n');
}

/**
 * Prove whether a delivered payload is still in the cursor-anchored active
 * composer. Matching only that region avoids mistaking old transcript output
 * for pending input after the message has already submitted.
 */
export function activeComposerPayloadPresence(
  viewport: PaneViewport,
  content: string,
): ComposerPayloadPresence {
  const verify = deliveryVerifyLine(content);
  if (verify.length < 3) return 'unproven';
  const composer = activeComposerRegion(viewport);
  if (composer === null) return 'unproven';
  return composer.includes(verify.slice(0, 40)) ? 'present' : 'absent';
}

const PASTE_PLACEHOLDER = /\[Pasted text #\d+/;

/**
 * PAN-4492: the composer of a screen read with no cursor row (Herdr `pane.read`).
 * Two or more rule rows: the rows strictly between the last two. One rule row:
 * the rows above it (a paste taller than the screen pushes the top rule off).
 * None: null.
 */
export function ruleBoundedComposerRegion(screen: string): string | null {
  const lines = screen.replace(PANE_ANSI_PATTERN, '').split('\n');
  const rules: number[] = [];
  lines.forEach((line, index) => { if (COMPOSER_TOP_BOUNDARY.test(line)) rules.push(index); });
  if (rules.length === 0) return null;
  const bottom = rules[rules.length - 1]!;
  const top = rules.length >= 2 ? rules[rules.length - 2]! : -1;
  return lines.slice(top + 1, bottom).join('\n');
}

const normalizeComposerText = (value: string): string => value.replace(/[─-╿\s ]/g, '');

/** PAN-4492: payload presence in a cursor-less screen's composer. */
export function screenComposerPayloadPresence(screen: string, content: string): ComposerPayloadPresence {
  const region = ruleBoundedComposerRegion(screen);
  if (region === null) return 'unproven';
  if (PASTE_PLACEHOLDER.test(region)) return 'present';
  const verify = normalizeComposerText(deliveryVerifyLine(content).slice(0, 40));
  if (verify.length < 3) return 'unproven';
  return normalizeComposerText(region).includes(verify) ? 'present' : 'absent';
}
