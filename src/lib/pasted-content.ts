/**
 * Claude Code records a long bracketed paste as
 * `<pasted_content id="N">\n<text>\n</pasted_content id="N">` (PAN-4305).
 * Composer messages arrive as pastes, so the operator's own text carries this
 * wrapper in landed and queued transcript records.
 */
const OPENING_TAG = /<pasted_content(?: id="[^"]*")?>\n?/
const OPENING_TAGS = /<pasted_content(?: id="[^"]*")?>\n?/g
const CLOSING_TAGS = /\n?<\/pasted_content(?: id="[^"]*")?>/g

export function hasPastedContentWrapper(text: string): boolean {
  return OPENING_TAG.test(text)
}

export function stripPastedContentWrappers(text: string): string {
  if (!hasPastedContentWrapper(text)) return text
  return text.replace(OPENING_TAGS, '').replace(CLOSING_TAGS, '').trim()
}
