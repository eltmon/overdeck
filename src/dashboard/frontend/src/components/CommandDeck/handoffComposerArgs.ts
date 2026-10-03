/**
 * PAN-4499 WI-9 (D13): pull `--skill`, `--pack` and `--hold` tokens out of the
 * `/handoff`/`/pan handoff` composer text, wherever they appear — the
 * `/pan handoff` control-plane path moves every flag after the positionals, so
 * `/pan handoff --skill grilling --hold do X` arrives as `do X --skill grilling --hold`.
 */
export interface ParsedHandoffComposerArgs {
  focus?: string;
  skills: string[];
  packs: string[];
  hold: boolean;
}

const FLAG_WITH_VALUE = /(?:^|\s)(--skill|--pack)(?:=(\S+)|\s+(\S+))/g;
const HOLD_FLAG = /(?:^|\s)--hold(?=\s|$)/g;

export function parseHandoffComposerArgs(text?: string): ParsedHandoffComposerArgs {
  const skills: string[] = [];
  const packs: string[] = [];
  let hold = false;
  let remaining = text ?? '';

  remaining = remaining.replace(FLAG_WITH_VALUE, (_match, flag: string, eqValue: string | undefined, spaceValue: string | undefined) => {
    const value = eqValue ?? spaceValue ?? '';
    (flag === '--skill' ? skills : packs).push(value);
    return ' ';
  });
  remaining = remaining.replace(HOLD_FLAG, () => {
    hold = true;
    return ' ';
  });

  const focus = remaining.replace(/\s+/g, ' ').trim() || undefined;
  return { focus, skills, packs, hold };
}
