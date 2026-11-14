/**
 * PAN-5232: the text of a Herdr `pane.read` response. Herdr 0.9.1 answers
 * `{ type: 'pane_read', read: { text, … } }`, and `HerdrApiClient.call()`
 * returns that `result` unchanged, so readers that took `result.text` saw ''
 * on every read. Accepts the legacy `{ text }` shape too. Imports nothing:
 * herdr-submit.ts must not import herdr-api (import cycle through types.ts).
 */
let warnedUnrecognized = false;

export function herdrPaneReadText(result: unknown): string {
  const record = result !== null && typeof result === 'object' ? result as Record<string, unknown> : null;
  const read = record?.read;
  if (read !== null && typeof read === 'object' && typeof (read as { text?: unknown }).text === 'string') {
    return (read as { text: string }).text;
  }
  if (typeof record?.text === 'string') return record.text;
  if (!warnedUnrecognized) {
    warnedUnrecognized = true;
    console.warn(`[herdr] pane.read response has no read.text or text; treating the pane as empty (keys: ${Object.keys(record ?? {}).join(',')}) (PAN-5232)`);
  }
  return '';
}

/** Test-only: clear the once-per-process warning latch. */
export function resetHerdrPaneReadWarningForTests(): void {
  warnedUnrecognized = false;
}
