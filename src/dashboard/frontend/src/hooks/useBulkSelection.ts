import { useState, useCallback, useMemo, useRef, useEffect } from 'react';

export interface BulkSelection {
  selectedIds: Set<string>;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  deselectAll: (ids: string[]) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
  count: number;
}

export function useBulkSelection(issuesKey: string): BulkSelection {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const prevKeyRef = useRef(issuesKey);

  // Clear selection when the issues list identity changes
  useEffect(() => {
    if (prevKeyRef.current !== issuesKey) {
      setSelectedIds(new Set());
      prevKeyRef.current = issuesKey;
    }
  }, [issuesKey]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const deselectAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  const count = useMemo(() => selectedIds.size, [selectedIds]);

  return useMemo(
    () => ({ selectedIds, toggle, selectAll, deselectAll, clear, isSelected, count }),
    [selectedIds, toggle, selectAll, deselectAll, clear, isSelected, count]
  );
}
