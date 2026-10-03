/** PAN-4499: the held kickoff of a `--hold` handoff. Non-null `held_kickoff` means held. */
import { getOverdeckDatabase } from './infra.js';

export function holdKickoff(name: string, text: string): void {
  getOverdeckDatabase().prepare('UPDATE conversations SET held_kickoff = ? WHERE name = ?').run(text, name);
}

export function readHeldKickoff(name: string): string | null {
  const row = getOverdeckDatabase()
    .prepare('SELECT held_kickoff FROM conversations WHERE name = ?')
    .get<{ held_kickoff: string | null }>(name);
  return row?.held_kickoff ?? null;
}

/** Atomic: returns the text and clears it, or null when nothing is held. */
export function claimHeldKickoff(name: string): string | null {
  const db = getOverdeckDatabase();
  return db.transaction((): string | null => {
    const row = db.prepare('SELECT held_kickoff FROM conversations WHERE name = ?').get<{ held_kickoff: string | null }>(name);
    const text = row?.held_kickoff ?? null;
    if (text === null) return null;
    db.prepare('UPDATE conversations SET held_kickoff = NULL WHERE name = ? AND held_kickoff IS NOT NULL').run(name);
    return text;
  })();
}

export function restoreHeldKickoff(name: string, text: string): void {
  getOverdeckDatabase().prepare('UPDATE conversations SET held_kickoff = ? WHERE name = ? AND held_kickoff IS NULL').run(text, name);
}
