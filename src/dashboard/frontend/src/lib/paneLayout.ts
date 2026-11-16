/**
 * Pane layout tree (PAN-1591) — a binary split tree describing how the deck's
 * visible panes are arranged. A `leaf` shows one pane; a `split` divides its
 * area between two child layouts along a direction, with `ratio` giving child
 * `a`'s fraction. Arbitrary grids compose from nested splits.
 *
 * The tree references panes by `paneId` (stable, from panesStore), so a layout
 * persists meaningfully across reloads. A single-leaf tree means "no split" —
 * the deck behaves exactly as the classic single-pane view.
 */
export type PaneLayout =
  | { kind: 'leaf'; paneId: string }
  | { kind: 'split'; dir: 'row' | 'col'; a: PaneLayout; b: PaneLayout; ratio: number }

/** Path to a split node: a sequence of 'a'/'b' descents from the root. */
export type SplitPath = Array<'a' | 'b'>

export function leaf(paneId: string): PaneLayout {
  return { kind: 'leaf', paneId }
}

export function isSplit(node: PaneLayout | null | undefined): node is Extract<PaneLayout, { kind: 'split' }> {
  return !!node && node.kind === 'split'
}

/** All paneIds referenced by the tree, in left-to-right / top-to-bottom order. */
export function collectLeafIds(node: PaneLayout): string[] {
  if (node.kind === 'leaf') return [node.paneId]
  return [...collectLeafIds(node.a), ...collectLeafIds(node.b)]
}

export function hasLeaf(node: PaneLayout, paneId: string): boolean {
  return collectLeafIds(node).includes(paneId)
}

/** Number of leaves (panes) in the tree. */
export function leafCount(node: PaneLayout): number {
  return node.kind === 'leaf' ? 1 : leafCount(node.a) + leafCount(node.b)
}

/**
 * Split the leaf showing `targetPaneId` into two, inserting `newPaneId` beside
 * it. `dir` chooses row (side-by-side) or col (stacked); `before` puts the new
 * pane first (left/top). No-op if the target leaf isn't found.
 */
export function splitAtLeaf(
  node: PaneLayout,
  targetPaneId: string,
  newPaneId: string,
  dir: 'row' | 'col',
  before = false,
): PaneLayout {
  if (node.kind === 'leaf') {
    if (node.paneId !== targetPaneId) return node
    const fresh = leaf(newPaneId)
    return { kind: 'split', dir, a: before ? fresh : node, b: before ? node : fresh, ratio: 0.5 }
  }
  return { ...node, a: splitAtLeaf(node.a, targetPaneId, newPaneId, dir, before), b: splitAtLeaf(node.b, targetPaneId, newPaneId, dir, before) }
}

/**
 * Remove the (first) leaf showing `paneId`, collapsing its parent split to the
 * surviving sibling. Returns null if the tree becomes empty.
 */
export function removeLeaf(node: PaneLayout, paneId: string): PaneLayout | null {
  if (node.kind === 'leaf') return node.paneId === paneId ? null : node
  const a = removeLeaf(node.a, paneId)
  const b = removeLeaf(node.b, paneId)
  if (!a) return b
  if (!b) return a
  return { ...node, a, b }
}

/**
 * Drop any leaves whose paneId is not in `valid`, collapsing splits. Used to
 * heal a restored layout against the live pane set. Returns null if nothing
 * valid remains.
 */
export function pruneToValid(node: PaneLayout, valid: ReadonlySet<string>): PaneLayout | null {
  if (node.kind === 'leaf') return valid.has(node.paneId) ? node : null
  const a = pruneToValid(node.a, valid)
  const b = pruneToValid(node.b, valid)
  if (!a) return b
  if (!b) return a
  return { ...node, a, b }
}

/** Replace the paneId shown by the (first) leaf matching `fromPaneId`. */
export function replaceLeaf(node: PaneLayout, fromPaneId: string, toPaneId: string): PaneLayout {
  if (node.kind === 'leaf') return node.paneId === fromPaneId ? leaf(toPaneId) : node
  return { ...node, a: replaceLeaf(node.a, fromPaneId, toPaneId), b: replaceLeaf(node.b, fromPaneId, toPaneId) }
}

/** Set the ratio of the split node at `path`. */
export function updateRatio(node: PaneLayout, path: SplitPath, ratio: number): PaneLayout {
  if (node.kind !== 'split') return node
  if (path.length === 0) return { ...node, ratio: Math.min(0.85, Math.max(0.15, ratio)) }
  const [head, ...rest] = path
  return head === 'a'
    ? { ...node, a: updateRatio(node.a, rest, ratio) }
    : { ...node, b: updateRatio(node.b, rest, ratio) }
}

/** Lightweight structural validation for a restored-from-JSON value. */
export function isValidLayout(value: unknown): value is PaneLayout {
  if (!value || typeof value !== 'object') return false
  const node = value as Record<string, unknown>
  if (node.kind === 'leaf') return typeof node.paneId === 'string'
  if (node.kind === 'split') {
    return (
      (node.dir === 'row' || node.dir === 'col') &&
      typeof node.ratio === 'number' &&
      isValidLayout(node.a) &&
      isValidLayout(node.b)
    )
  }
  return false
}

// ─── Equal layout presets (PAN-5343 H-D7) ─────────────────────────────────────

/** The four equal layouts: One, Two side by side, Three columns, Grid of four. */
export type LayoutPreset = 1 | 2 | 3 | 4

function rowSplit(a: PaneLayout, b: PaneLayout, ratio = 0.5): PaneLayout {
  return { kind: 'split', dir: 'row', a, b, ratio }
}

/**
 * Build the equal layout for `preset` from the first `preset` ids, in reading
 * order: 1 → one leaf; 2 → two halves side by side; 3 → three equal columns;
 * 4 → a 2×2 grid. Throws when fewer ids than `preset` are given.
 */
export function presetLayout(paneIds: readonly string[], preset: LayoutPreset): PaneLayout {
  if (paneIds.length < preset) throw new Error(`presetLayout needs ${preset} panes`)
  const [a, b, c, d] = paneIds
  switch (preset) {
    case 1:
      return leaf(a)
    case 2:
      return rowSplit(leaf(a), leaf(b))
    case 3:
      return rowSplit(leaf(a), rowSplit(leaf(b), leaf(c)), 1 / 3)
    case 4:
      return { kind: 'split', dir: 'col', a: rowSplit(leaf(a), leaf(b)), b: rowSplit(leaf(c), leaf(d)), ratio: 0.5 }
  }
}

/** Same kind/dir nesting, ratios and pane ids ignored. */
function sameShape(x: PaneLayout, y: PaneLayout): boolean {
  if (x.kind === 'leaf' || y.kind === 'leaf') return x.kind === y.kind
  return x.dir === y.dir && sameShape(x.a, y.a) && sameShape(x.b, y.b)
}

/**
 * Which preset a layout is, ignoring ratios: a null layout or a single leaf is
 * 1; otherwise the preset with the same leaf count and nesting, else null.
 */
export function presetOf(layout: PaneLayout | null): LayoutPreset | null {
  if (!layout || layout.kind === 'leaf') return 1
  const n = leafCount(layout)
  if (n < 2 || n > 4) return null
  const preset = n as LayoutPreset
  const ids = Array.from({ length: n }, (_, i) => `p${i}`)
  return sameShape(layout, presetLayout(ids, preset)) ? preset : null
}
