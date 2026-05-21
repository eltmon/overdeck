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
}

export async function loadVoices(): Promise<TtsVoice[]> {
  try {
    const content = await readFile(getTtsVoicesPath(), 'utf-8');
    return JSON.parse(content) as TtsVoice[];
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function saveVoices(voices: TtsVoice[]): Promise<void> {
  const filePath = getTtsVoicesPath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(voices, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  await chmod(filePath, 0o600);
}

export async function addVoice(voice: Omit<TtsVoice, 'id' | 'createdAt'>): Promise<TtsVoice> {
  const voices = await loadVoices();
  const newVoice: TtsVoice = {
    ...voice,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await saveVoices([...voices, newVoice]);
  return newVoice;
}

export async function deleteVoice(id: string): Promise<boolean> {
  const voices = await loadVoices();
  const remaining = voices.filter((voice) => voice.id !== id);
  if (remaining.length === voices.length) return false;
  await saveVoices(remaining);
  return true;
}

export async function clearVoices(): Promise<number> {
  const voices = await loadVoices();
  if (voices.length === 0) return 0;
  await saveVoices([]);
  return voices.length;
}

export async function findVoiceById(id: string): Promise<TtsVoice | undefined> {
  const voices = await loadVoices();
  return voices.find((voice) => voice.id === id);
}

export async function findVoiceByName(name: string): Promise<TtsVoice | undefined> {
  const voices = await loadVoices();
  return voices.find((voice) => voice.name === name);
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Load all configured TTS voices. FsError on disk failure (ENOENT → []). */
export const loadVoicesEffect = (): Effect.Effect<readonly TtsVoice[], FsError> =>
  Effect.tryPromise({
    try: () => loadVoices(),
    catch: (cause) =>
      new FsError({ path: getTtsVoicesPath(), operation: 'loadVoices', cause }),
  });

/** Persist the supplied voice list atomically (mode 0o600). */
export const saveVoicesEffect = (
  voices: readonly TtsVoice[],
): Effect.Effect<void, FsError> =>
  Effect.tryPromise({
    try: () => saveVoices([...voices]),
    catch: (cause) =>
      new FsError({ path: getTtsVoicesPath(), operation: 'saveVoices', cause }),
  });

/** Append a new voice (generates id + createdAt). */
export const addVoiceEffect = (
  voice: Omit<TtsVoice, 'id' | 'createdAt'>,
): Effect.Effect<TtsVoice, FsError> =>
  Effect.tryPromise({
    try: () => addVoice(voice),
    catch: (cause) =>
      new FsError({ path: getTtsVoicesPath(), operation: 'addVoice', cause }),
  });

/** Delete a voice by id; returns true if anything was removed. */
export const deleteVoiceEffect = (id: string): Effect.Effect<boolean, FsError> =>
  Effect.tryPromise({
    try: () => deleteVoice(id),
    catch: (cause) =>
      new FsError({ path: getTtsVoicesPath(), operation: 'deleteVoice', cause }),
  });

/** Remove all voices; returns the number removed. */
export const clearVoicesEffect = (): Effect.Effect<number, FsError> =>
  Effect.tryPromise({
    try: () => clearVoices(),
    catch: (cause) =>
      new FsError({ path: getTtsVoicesPath(), operation: 'clearVoices', cause }),
  });

/** Find a voice by id. */
export const findVoiceByIdEffect = (
  id: string,
): Effect.Effect<TtsVoice | undefined, FsError> =>
  Effect.tryPromise({
    try: () => findVoiceById(id),
    catch: (cause) =>
      new FsError({ path: getTtsVoicesPath(), operation: 'findVoiceById', cause }),
  });

/** Find a voice by name. */
export const findVoiceByNameEffect = (
  name: string,
): Effect.Effect<TtsVoice | undefined, FsError> =>
  Effect.tryPromise({
    try: () => findVoiceByName(name),
    catch: (cause) =>
      new FsError({ path: getTtsVoicesPath(), operation: 'findVoiceByName', cause }),
  });
