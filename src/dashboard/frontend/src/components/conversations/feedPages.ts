export interface FeedPage<Row extends { id: number; source: string }> {
  rows: Row[];
}

export function feedRowKey(row: { id: number; source: string }): string {
  return `${row.source}:${row.id}`;
}

export function accumulateFeedPages<Row extends { id: number; source: string }>(pages: FeedPage<Row>[] | undefined): Row[] {
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const page of pages ?? []) {
    for (const row of page.rows) {
      const key = feedRowKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return rows;
}
