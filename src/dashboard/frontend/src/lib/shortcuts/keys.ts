// Key specs for the shortcut registry (PAN-5287 §6.7): parse, match, format.
//
// A spec is a string: modifiers `Meta`, `Ctrl`, `Alt`, `Shift` joined by `+`
// before one key (`Meta+K`, `Ctrl+Alt+1`, `Ctrl+Shift+.`, `N`, `?`, `/`, `[`).
// A two-step chord is two specs separated by one space (`G P`).

export type Platform = 'mac' | 'other'

/** null = unbound on that platform. */
export interface ShortcutKeys {
  mac: string | null
  other: string | null
}

/** Read on every call so tests can stub `navigator.platform`. */
export function currentPlatform(): Platform {
  return typeof navigator !== 'undefined' && navigator.platform.includes('Mac') ? 'mac' : 'other'
}

type Modifier = 'Meta' | 'Ctrl' | 'Alt' | 'Shift'

const MODIFIERS: readonly Modifier[] = ['Meta', 'Ctrl', 'Alt', 'Shift']

/** Characters that need Shift on a US layout; their specs ignore `shiftKey`. */
const SHIFTED_CHARACTERS = new Set(['?', '>', '<', ':', '"', '{', '}', '|', '~', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+'])

interface Step {
  modifiers: ReadonlySet<Modifier>
  key: string
}

function parseStep(step: string): Step {
  const parts = step.split('+')
  // A trailing '+' key ("Ctrl++") leaves an empty last part.
  const key = parts.length > 1 && parts[parts.length - 1] === '' ? '+' : parts[parts.length - 1]
  const modifiers = new Set<Modifier>()
  for (const part of parts.slice(0, parts.length - 1)) {
    if ((MODIFIERS as readonly string[]).includes(part)) modifiers.add(part as Modifier)
  }
  return { modifiers, key }
}

/** The steps of a spec: one for a plain shortcut, two for a chord. */
export function specSteps(spec: string): string[] {
  return spec.split(' ').filter(Boolean)
}

function modifierPressed(event: KeyboardEvent, modifier: Modifier): boolean {
  switch (modifier) {
    case 'Meta':
      return event.metaKey
    case 'Ctrl':
      return event.ctrlKey
    case 'Alt':
      return event.altKey
    case 'Shift':
      return event.shiftKey
  }
}

function keyMatches(event: KeyboardEvent, key: string): boolean {
  if (/^[A-Za-z]$/.test(key)) {
    // Alt changes event.key on macOS (⌥P is "π"), so the physical key also counts.
    return event.key.toLowerCase() === key.toLowerCase() || event.code === `Key${key.toUpperCase()}`
  }
  if (/^\d$/.test(key)) return event.key === key || event.code === `Digit${key}`
  if (key === '.') return event.code === 'Period' || event.key === '.' || event.key === '>'
  return event.key === key
}

/** True when `event` matches one step of a spec (a chord's step, or a plain spec). */
export function matchesSpec(event: KeyboardEvent, spec: string): boolean {
  const { modifiers, key } = parseStep(spec)
  const ignoreShift = SHIFTED_CHARACTERS.has(key)
  for (const modifier of MODIFIERS) {
    if (modifier === 'Shift' && ignoreShift) continue
    if (modifierPressed(event, modifier) !== modifiers.has(modifier)) return false
  }
  return keyMatches(event, key)
}

const MAC_SYMBOL: Record<Modifier, string> = { Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }

function formatStep(step: string, platform: Platform): string {
  const parts = step.split('+')
  const { key } = parseStep(step)
  const mods = parts.slice(0, parts.length - 1).filter((p): p is Modifier => (MODIFIERS as readonly string[]).includes(p))
  const printedKey = key.length === 1 ? key.toUpperCase() : key
  if (platform === 'mac') return `${mods.map((m) => MAC_SYMBOL[m]).join('')}${printedKey}`
  return [...mods, printedKey].join(' ')
}

/** Keycap text: `⌘⇧.` on mac, `Ctrl Shift .` elsewhere; a chord prints as `G then P`. */
export function formatSpec(spec: string, platform: Platform): string {
  return specSteps(spec)
    .map((step) => formatStep(step, platform))
    .join(' then ')
}
