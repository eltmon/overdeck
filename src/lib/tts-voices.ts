import { randomUUID } from 'crypto';
import { chmod, mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { getOverdeckHome } from './paths.js';

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
  return join(getOverdeckHome(), 'tts-voices.json');
}

/** Load all configured TTS voices. Rejects on disk failure; a missing file (ENOENT) yields []. */
export async function loadVoices(): Promise<TtsVoice[]> {
  try {
    const content = await readFile(getTtsVoicesPath(), 'utf-8');
    return JSON.parse(content) as TtsVoice[];
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Persist the supplied voice list atomically (mode 0o600). */
export async function saveVoices(voices: TtsVoice[]): Promise<void> {
  const filePath = getTtsVoicesPath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(voices, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  await chmod(filePath, 0o600);
}

/** Append a new voice (generates id + createdAt). */
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

/** Delete a voice by id; returns true if anything was removed. */
export async function deleteVoice(id: string): Promise<boolean> {
  const voices = await loadVoices();
  const remaining = voices.filter((voice) => voice.id !== id);
  if (remaining.length === voices.length) return false;
  await saveVoices(remaining);
  return true;
}

/** Remove all voices; returns the number removed. */
export async function clearVoices(): Promise<number> {
  const voices = await loadVoices();
  if (voices.length === 0) return 0;
  await saveVoices([]);
  return voices.length;
}

/** Find a voice by id. */
export async function findVoiceById(id: string): Promise<TtsVoice | undefined> {
  const voices = await loadVoices();
  return voices.find((voice) => voice.id === id);
}

/** Find a voice by name. */
export async function findVoiceByName(name: string): Promise<TtsVoice | undefined> {
  const voices = await loadVoices();
  return voices.find((voice) => voice.name === name);
}
