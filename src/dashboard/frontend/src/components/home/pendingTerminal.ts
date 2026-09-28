/**
 * PAN-4280 — Terminal hand-off: carries a typed command from the Home
 * composer or a deck Launcher to the terminal drawer across the hard
 * navigation to `/command-deck/<deckKey>` (D5). sessionStorage survives
 * that navigation; a same-tab CustomEvent lets an already-mounted drawer
 * react without a reload.
 */

export const PENDING_TERMINAL_KEY = 'overdeck:pending-terminal';
export const PENDING_TERMINAL_EVENT = 'overdeck:pending-terminal';
export const PENDING_TERMINAL_MAX_AGE_MS = 30_000;

interface PendingTerminalRecord {
  deckKey: string;
  command: string;
  at: number;
}

function readRecord(): PendingTerminalRecord | null {
  try {
    const raw = sessionStorage.getItem(PENDING_TERMINAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingTerminalRecord;
  } catch {
    return null;
  }
}

function clearRecord(): void {
  try {
    sessionStorage.removeItem(PENDING_TERMINAL_KEY);
  } catch {
    // ignore
  }
}

function isFresh(record: PendingTerminalRecord): boolean {
  return Date.now() - record.at < PENDING_TERMINAL_MAX_AGE_MS;
}

export function writePendingTerminal(entry: { deckKey: string; command: string }): void {
  try {
    const record: PendingTerminalRecord = { deckKey: entry.deckKey, command: entry.command, at: Date.now() };
    sessionStorage.setItem(PENDING_TERMINAL_KEY, JSON.stringify(record));
  } catch {
    // storage unavailable — the hand-off is simply lost
  }
  try {
    window.dispatchEvent(new CustomEvent(PENDING_TERMINAL_EVENT, { detail: { deckKey: entry.deckKey } }));
  } catch {
    // ignore
  }
}

/** Read the hand-off for `deckKey`, never deleting it. */
export function peekPendingTerminal(deckKey: string): string | null {
  const record = readRecord();
  if (!record || record.deckKey !== deckKey || !isFresh(record)) return null;
  return record.command;
}

/** Read and delete the hand-off for `deckKey`. A record for another deck is
 * left untouched; a stale record is deleted but not returned. */
export function takePendingTerminal(deckKey: string): string | null {
  const record = readRecord();
  if (!record) return null;
  if (record.deckKey !== deckKey) return null;
  if (!isFresh(record)) {
    clearRecord();
    return null;
  }
  clearRecord();
  return record.command;
}
