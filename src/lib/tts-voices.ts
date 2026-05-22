import { randomUUID } from 'crypto';
import { chmod, mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { Effect } from 'effect';
import { getPanopticonHome } from './paths.js';
import { FsError } from './errors.js';

export type TtsVoiceKind = 'preset' | 'design' | 'clone';

export interface TtsVoice {
  id: string;
  name: string;
  kind: TtsVoiceKind;
  createdAt: string;
  presetName?: string;
  description?: string;
  instruct?: string;
  embedding?: number[];
}

export function getTtsVoicesPath(): string {
  return join(getPanopticonHome(), 'tts-voices.json');
}async function loadVoicesPromise(): Promise<TtsVoice[]> {
  try {
    const content = await readFile(getTtsVoicesPath(), 'utf-8');
    return JSON.parse(content) as TtsVoice[];
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}async function saveVoicesPromise(voices: TtsVoice[]): Promise<void> {
  const filePath = getTtsVoicesPath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(voices, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  await chmod(filePath, 0o600);
}async function addVoicePromise(voice: Omit<TtsVoice, 'id' | 'createdAt'>): Promise<TtsVoice> {
  const voices = await Effect.runPromise(loadVoices());
  const newVoice: TtsVoice = {
    ...voice,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await Effect.runPromise(saveVoices([...voices, newVoice]));
  return newVoice;
}async function deleteVoicePromise(id: string): Promise<boolean> {
  const voices = await Effect.runPromise(loadVoices());
  const remaining = voices.filter((voice) => voice.id !== id);
  if (remaining.length === voices.length) return false;
  await Effect.runPromise(saveVoices(remaining));
  return true;
}async function clearVoicesPromise(): Promise<number> {
  const voices = await Effect.runPromise(loadVoices());
  if (voices.length === 0) return 0;
  await Effect.runPromise(saveVoices([]));
  return voices.length;
}async function findVoiceByIdPromise(id: string): Promise<TtsVoice | undefined> {
  const voices = await Effect.runPromise(loadVoices());
  return voices.find((voice) => voice.id === id);
}async function findVoiceByNamePromise(name: string): Promise<TtsVoice | undefined> {
  const voices = await Effect.runPromise(loadVoices());
  return voices.find((voice) => voice.name === name);
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Load all configured TTS voices. FsError on disk failure (ENOENT → []). */
export const loadVoices = (): Effect.Effect<readonly TtsVoice[], FsError> =>
  Effect.tryPromise({
    try: () => loadVoicesPromise(),
    catch: (cause) =>
      new FsError({ path: getTtsVoicesPath(), operation: 'loadVoices', cause }),
  });

/** Persist the supplied voice list atomically (mode 0o600). */
export const saveVoices = (
  voices: readonly TtsVoice[],
): Effect.Effect<void, FsError> =>
  Effect.tryPromise({
    try: () => saveVoicesPromise([...voices]),
    catch: (cause) =>
      new FsError({ path: getTtsVoicesPath(), operation: 'saveVoices', cause }),
  });

/** Append a new voice (generates id + createdAt). */
export const addVoice = (
  voice: Omit<TtsVoice, 'id' | 'createdAt'>,
): Effect.Effect<TtsVoice, FsError> =>
  Effect.tryPromise({
    try: () => addVoicePromise(voice),
    catch: (cause) =>
      new FsError({ path: getTtsVoicesPath(), operation: 'addVoice', cause }),
  });

/** Delete a voice by id; returns true if anything was removed. */
export const deleteVoice = (id: string): Effect.Effect<boolean, FsError> =>
  Effect.tryPromise({
    try: () => deleteVoicePromise(id),
    catch: (cause) =>
      new FsError({ path: getTtsVoicesPath(), operation: 'deleteVoice', cause }),
  });

/** Remove all voices; returns the number removed. */
export const clearVoices = (): Effect.Effect<number, FsError> =>
  Effect.tryPromise({
    try: () => clearVoicesPromise(),
    catch: (cause) =>
      new FsError({ path: getTtsVoicesPath(), operation: 'clearVoices', cause }),
  });

/** Find a voice by id. */
export const findVoiceById = (
  id: string,
): Effect.Effect<TtsVoice | undefined, FsError> =>
  Effect.tryPromise({
    try: () => findVoiceByIdPromise(id),
    catch: (cause) =>
      new FsError({ path: getTtsVoicesPath(), operation: 'findVoiceById', cause }),
  });

/** Find a voice by name. */
export const findVoiceByName = (
  name: string,
): Effect.Effect<TtsVoice | undefined, FsError> =>
  Effect.tryPromise({
    try: () => findVoiceByNamePromise(name),
    catch: (cause) =>
      new FsError({ path: getTtsVoicesPath(), operation: 'findVoiceByName', cause }),
  });
