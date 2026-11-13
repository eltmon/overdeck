// Natural sort for explorer entries (PAN-5186, FR-2): directories first, then
// names compared with numeric collation, so file9 < file99 < file100.

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function compareNames(a: string, b: string): number {
  return collator.compare(a, b)
}

export function compareEntries(a: { kind: string; name: string }, b: { kind: string; name: string }): number {
  const aDir = a.kind === 'dir'
  const bDir = b.kind === 'dir'
  if (aDir !== bDir) return aDir ? -1 : 1
  return collator.compare(a.name, b.name)
}
