/**
 * Splits a leading YAML front matter block off a Markdown/MDX body (PAN-5427).
 * A hand-rolled splitter, not a YAML parser: values are returned as plain
 * text per the PRD's value rules (quotes stripped, block scalars and
 * list/map continuations dedented and joined). Front matter is only
 * recognized when line 0 is a `---` fence, a later `---` fence closes it,
 * and at least one top-level key line appears between them; anything else
 * returns the body unchanged so a stray `---` still renders as an `<hr>`.
 */
export interface FrontMatterEntry {
  key: string
  value: string
}

export interface FrontMatterSplit {
  /** Entries in display order: title, description, then source order. Empty when no front matter was found. */
  entries: FrontMatterEntry[]
  /** The Markdown to render: the body after the closing fence, or the unchanged body. */
  content: string
}

const TOP_LEVEL_KEY = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?:\s+(.*)|\s*)$/
const BLOCK_SCALAR_INDICATORS = new Set(['|', '|-', '|+', '>', '>-', '>+'])

function isFenceLine(line: string): boolean {
  return line.replace(/[ \t\r]+$/, '') === '---'
}

function unquote(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0]
    const last = raw[raw.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return raw.slice(1, -1)
    }
  }
  return raw
}

function commonIndent(lines: string[]): number {
  let min = Infinity
  for (const line of lines) {
    if (line.trim() === '') continue
    const leading = /^[ \t]*/.exec(line)?.[0].length ?? 0
    if (leading < min) min = leading
  }
  return min === Infinity ? 0 : min
}

function dedent(lines: string[]): string[] {
  const indent = commonIndent(lines)
  return lines.map((line) => (line.trim() === '' ? '' : line.slice(indent)))
}

interface PendingEntry {
  key: string
  inlineValue: string
  isBlock: boolean
  continuation: string[]
}

function finalizeValue(entry: PendingEntry): string {
  if (entry.isBlock) {
    return dedent(entry.continuation).join('\n')
  }
  if (entry.continuation.length > 0) {
    const dedented = dedent(entry.continuation)
    return entry.inlineValue !== '' ? [entry.inlineValue, ...dedented].join('\n') : dedented.join('\n')
  }
  return entry.inlineValue
}

export function splitFrontMatter(body: string): FrontMatterSplit {
  const stripped = body.length > 0 && body.charCodeAt(0) === 0xfeff ? body.slice(1) : body
  const lines = stripped.split(/\r?\n/)

  if (lines.length === 0 || !isFenceLine(lines[0])) {
    return { entries: [], content: body }
  }

  let closeIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (isFenceLine(lines[i])) {
      closeIdx = i
      break
    }
  }
  if (closeIdx === -1) {
    return { entries: [], content: body }
  }

  const entries: FrontMatterEntry[] = []
  let current: PendingEntry | null = null

  const finalize = () => {
    if (current) {
      entries.push({ key: current.key, value: finalizeValue(current) })
      current = null
    }
  }

  for (let i = 1; i < closeIdx; i++) {
    const line = lines[i]
    if (line.startsWith('#')) continue
    if (line.trim() === '') {
      if (current?.isBlock) current.continuation.push('')
      continue
    }
    const match = TOP_LEVEL_KEY.exec(line)
    if (match) {
      finalize()
      const inlineRaw = (match[2] ?? '').trim()
      const isBlock = BLOCK_SCALAR_INDICATORS.has(inlineRaw)
      current = { key: match[1], inlineValue: isBlock ? '' : unquote(inlineRaw), isBlock, continuation: [] }
      continue
    }
    if (current) current.continuation.push(line)
  }
  finalize()

  if (entries.length === 0) {
    return { entries: [], content: body }
  }

  const titleEntries = entries.filter((e) => e.key === 'title')
  const descriptionEntries = entries.filter((e) => e.key === 'description')
  const rest = entries.filter((e) => e.key !== 'title' && e.key !== 'description')
  const ordered = [...titleEntries, ...descriptionEntries, ...rest]

  const content = lines.slice(closeIdx + 1).join('\n')
  return { entries: ordered, content }
}
