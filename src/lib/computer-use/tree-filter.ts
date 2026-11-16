/**
 * Filters a rendered accessibility tree (`treeLines`, one tab-indented line
 * per element — see the helper's `render_accessibility_tree`) down to the
 * lines matching `query` plus each match's ancestors (PAN-5452, PRD 3g).
 * Pure, no I/O.
 */
function leadingTabCount(line: string): number {
  let count = 0;
  while (line[count] === '\t') count++;
  return count;
}

export function filterTree(lines: readonly string[], query: string, maxElements?: number): string[] {
  const needle = query.toLowerCase();
  const depths = lines.map(leadingTabCount);

  const matchIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(needle)) {
      matchIndices.push(i);
      if (maxElements !== undefined && matchIndices.length >= maxElements) break;
    }
  }
  if (matchIndices.length === 0) return [`No element matches "${query}".`];

  const kept = new Set<number>();
  for (const index of matchIndices) {
    kept.add(index);
    let depth = depths[index];
    for (let i = index - 1; i >= 0 && depth > 0; i--) {
      if (depths[i] < depth) {
        kept.add(i);
        depth = depths[i];
      }
    }
  }
  return [...kept].sort((a, b) => a - b).map((i) => lines[i]);
}
