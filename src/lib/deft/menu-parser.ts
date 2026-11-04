/**
 * Deft's deterministic menu, parsed from assistant text (PAN-4849 WI-5,
 * PAN-4820 PRD 3.4).
 *
 * Deft renders a menu as plain numbered lines whose last two labels are
 * `Discuss` and `Back`, and accepts only the displayed number or the exact
 * displayed label. Overdeck sees the menu only as transcript text, so this
 * parser recognizes the shape and keeps each option as `<n>. <label>`.
 */

const MENU_LINE = /^\s*(\d+)\.\s+(.+?)\s*$/;
const TAIL_LINES = 40;
const MIN_OPTIONS = 3;

export interface DeftMenu {
  prompt: string;
  options: string[];
}

export function parseDeftMenu(text: string): DeftMenu | null {
  const lines = text.split(/\r?\n/).slice(-TAIL_LINES);
  // The last run of consecutive numbered lines; any other line ends a run.
  let end = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (MENU_LINE.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  let start = end;
  while (start > 0 && MENU_LINE.test(lines[start - 1]!)) start--;

  const entries = lines.slice(start, end + 1).map(line => {
    const match = MENU_LINE.exec(line)!;
    return { n: Number(match[1]), label: match[2]! };
  });
  if (entries.length < MIN_OPTIONS) return null;
  if (entries.some((entry, index) => entry.n !== index + 1)) return null;
  if (entries.at(-2)!.label !== 'Discuss' || entries.at(-1)!.label !== 'Back') return null;

  let prompt = '';
  for (let i = start - 1; i >= 0; i--) {
    if (lines[i]!.trim()) {
      prompt = lines[i]!.trim();
      break;
    }
  }
  return { prompt, options: entries.map(entry => `${entry.n}. ${entry.label}`) };
}
