import { parseSequenceJson } from './types.js';
import type { SequenceDoc, SequenceParseError } from './types.js';

const MACHINE_MARKER = '<!-- machine-readable; do not hand-edit below this line -->';

export type ParseSequenceMdResult = { ok: true; doc: SequenceDoc } | SequenceParseError;

export function parseSequenceMd(markdown: string): ParseSequenceMdResult {
  const markerIdx = markdown.indexOf(MACHINE_MARKER);
  const searchText = markerIdx >= 0 ? markdown.slice(markerIdx) : markdown;

  const fenceMatch = searchText.match(/```json\s*\n([\s\S]*?)```/);
  if (!fenceMatch) {
    return { ok: false, error: 'No fenced JSON block found in sequence.md' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fenceMatch[1]);
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  return parseSequenceJson(parsed);
}
