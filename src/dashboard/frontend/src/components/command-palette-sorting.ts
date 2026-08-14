interface SortablePaletteAction {
  id: string;
  rank?: number;
  ts?: string | null;
}

export function compareByRank(a: SortablePaletteAction, b: SortablePaletteAction): number {
  return (a.rank ?? 0) - (b.rank ?? 0);
}

export function compareConversationHits(a: SortablePaletteAction, b: SortablePaletteAction): number {
  const aTime = a.ts ? Date.parse(a.ts) : Number.NaN;
  const bTime = b.ts ? Date.parse(b.ts) : Number.NaN;
  const aMissing = Number.isNaN(aTime);
  const bMissing = Number.isNaN(bTime);

  if (aMissing !== bMissing) return aMissing ? 1 : -1;
  if (!aMissing && aTime !== bTime) return bTime - aTime;
  return compareByRank(a, b) || a.id.localeCompare(b.id);
}
