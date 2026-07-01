import type { VBriefDocument, VBriefItem } from './types';

export interface VBriefReadinessOverlap {
  itemId: string;
  sharedFiles: string[];
}

export interface VBriefReadinessItemVerdict {
  id: string;
  overlaps: VBriefReadinessOverlap[];
}

export interface VBriefReadinessConflictGroup {
  itemIds: string[];
  sharedFiles: string[];
  reason: 'file_overlap' | 'low_confidence';
}

export interface VBriefReadinessWave {
  index: number;
  items: Array<{ id: string; title: string }>;
}

export interface VBriefReadinessVerdict {
  items: VBriefReadinessItemVerdict[];
  waves: VBriefReadinessWave[];
  conflictGroups: VBriefReadinessConflictGroup[];
  overlapMatrix: Record<string, Record<string, string[]>>;
}

interface VBriefReadinessPanelProps {
  doc: VBriefDocument & { readiness?: VBriefReadinessVerdict };
}

export function VBriefReadinessPanel({ doc }: VBriefReadinessPanelProps) {
  const verdict = doc.readiness ?? buildReadinessVerdict(doc);
  const matrixRows = Object.entries(verdict.overlapMatrix).flatMap(([itemId, overlaps]) =>
    Object.entries(overlaps)
      .filter(([otherId]) => itemId < otherId)
      .map(([otherId, sharedFiles]) => ({ itemId, otherId, sharedFiles })),
  );

  return (
    <section className="p-4 border-b border-border" aria-label="Readiness report">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Readiness report</h3>

      <div className="space-y-4 text-sm text-muted-foreground">
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1">Dependency waves</div>
          {verdict.waves.length === 0 ? (
            <p>No dependency waves.</p>
          ) : (
            <ol className="space-y-1">
              {verdict.waves.map(wave => (
                <li key={wave.index}>
                  <span className="font-mono text-muted-foreground">wave {wave.index}</span>
                  <span>: {wave.items.map(item => item.id).join(', ')}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1">File-overlap matrix</div>
          {matrixRows.length === 0 ? (
            <p>No cross-item file overlaps.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-1 pr-3 text-left font-semibold text-muted-foreground">Items</th>
                    <th className="py-1 text-left font-semibold text-muted-foreground">Shared files</th>
                  </tr>
                </thead>
                <tbody>
                  {matrixRows.map(row => (
                    <tr key={`${row.itemId}-${row.otherId}`} className="border-b border-border/60">
                      <td className="py-1 pr-3 font-mono text-muted-foreground">{row.itemId} / {row.otherId}</td>
                      <td className="py-1 text-muted-foreground">{row.sharedFiles.join(', ') || 'conservative overlap'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1">Conflict groups</div>
          {verdict.conflictGroups.length === 0 ? (
            <p>No conflict groups.</p>
          ) : (
            <ul className="space-y-1">
              {verdict.conflictGroups.map(group => (
                <li key={group.itemIds.join('|')} className="text-muted-foreground">
                  <span className="font-mono">{group.itemIds.join(' + ')}</span>
                  <span> ({group.reason})</span>
                  {group.sharedFiles.length > 0 && <span>: {group.sharedFiles.join(', ')}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function buildReadinessVerdict(doc: VBriefDocument): VBriefReadinessVerdict {
  const waves = groupItemsByWave(doc);
  const overlapMatrix: Record<string, Record<string, string[]>> = Object.fromEntries(
    doc.plan.items.map(item => [item.id, {} as Record<string, string[]>]),
  );
  const itemVerdicts = new Map<string, VBriefReadinessItemVerdict>(
    doc.plan.items.map(item => [item.id, { id: item.id, overlaps: [] }]),
  );
  const conflictGroups: VBriefReadinessConflictGroup[] = [];

  for (let i = 0; i < doc.plan.items.length; i++) {
    for (let j = i + 1; j < doc.plan.items.length; j++) {
      const left = doc.plan.items[i]!;
      const right = doc.plan.items[j]!;
      const sharedFiles = sharedScopeFiles(left, right);
      const lowConfidence = left.metadata?.files_scope_confidence === 'low' || right.metadata?.files_scope_confidence === 'low';
      if (sharedFiles.length === 0 && !lowConfidence) continue;

      overlapMatrix[left.id]![right.id] = sharedFiles;
      overlapMatrix[right.id]![left.id] = sharedFiles;
      itemVerdicts.get(left.id)?.overlaps.push({ itemId: right.id, sharedFiles });
      itemVerdicts.get(right.id)?.overlaps.push({ itemId: left.id, sharedFiles });
      conflictGroups.push({
        itemIds: [left.id, right.id],
        sharedFiles,
        reason: lowConfidence ? 'low_confidence' : 'file_overlap',
      });
    }
  }

  return {
    items: Array.from(itemVerdicts.values()),
    waves,
    conflictGroups,
    overlapMatrix,
  };
}

function groupItemsByWave(doc: VBriefDocument): VBriefReadinessWave[] {
  const actionable = doc.plan.items.filter(item => !['completed', 'cancelled', 'blocked', 'running'].includes(item.status));
  const actionableIds = new Set(actionable.map(item => item.id));
  const resolvedIds = new Set(doc.plan.items.filter(item => item.status === 'completed' || item.status === 'cancelled').map(item => item.id));
  const inDegree = new Map(actionable.map(item => [item.id, 0]));
  const outgoing = new Map(actionable.map(item => [item.id, [] as string[]]));

  for (const edge of doc.plan.edges.filter(edge => edge.type === 'blocks')) {
    if (!actionableIds.has(edge.to) || resolvedIds.has(edge.from)) continue;
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    if (actionableIds.has(edge.from)) outgoing.get(edge.from)?.push(edge.to);
  }

  const itemById = new Map(doc.plan.items.map(item => [item.id, item]));
  const waves: VBriefReadinessWave[] = [];
  let current = actionable.map(item => item.id).filter(id => (inDegree.get(id) ?? 0) === 0);
  let index = 0;
  while (current.length > 0) {
    waves.push({
      index,
      items: current.map(id => {
        const item = itemById.get(id)!;
        return { id, title: item.title };
      }),
    });
    const next: string[] = [];
    for (const id of current) {
      for (const child of outgoing.get(id) ?? []) {
        const degree = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, degree);
        if (degree === 0) next.push(child);
      }
    }
    current = next;
    index += 1;
  }
  return waves;
}

function sharedScopeFiles(left: VBriefItem, right: VBriefItem): string[] {
  const leftScope = scopeOf(left);
  const rightScope = scopeOf(right);
  const shared = new Set<string>();

  for (const filePath of leftScope) {
    if (rightScope.includes(filePath)) shared.add(filePath);
  }
  for (const filePath of rightScope) {
    if (leftScope.includes(filePath)) shared.add(filePath);
  }

  return Array.from(shared).sort();
}

function scopeOf(item: VBriefItem): string[] {
  const scope = item.metadata?.files_scope;
  return Array.isArray(scope) ? scope.filter((entry): entry is string => typeof entry === 'string') : [];
}
