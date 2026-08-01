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

function activeComposerRegion(viewport: PaneViewport): string | null {
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
