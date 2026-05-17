import { mkdtemp, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addVoice,
  clearVoices,
  deleteVoice,
  findVoiceById,
  findVoiceByName,
  getTtsVoicesPath,
  loadVoices,
  saveVoices,
} from '../tts-voices.js';

let tempHome: string;
let previousPanopticonHome: string | undefined;

beforeEach(async () => {
  previousPanopticonHome = process.env.PANOPTICON_HOME;
  tempHome = await mkdtemp(join(tmpdir(), 'pan-tts-voices-'));
  process.env.PANOPTICON_HOME = tempHome;
});

afterEach(async () => {
  if (previousPanopticonHome === undefined) {
    delete process.env.PANOPTICON_HOME;
  } else {
    process.env.PANOPTICON_HOME = previousPanopticonHome;
  }
  await rm(tempHome, { recursive: true, force: true });
});

describe('tts voices library', () => {
  it('returns an empty voice list when the library file is missing', async () => {
    await expect(loadVoices()).resolves.toEqual([]);
  });

  it('adds and persists a generated voice record', async () => {
    const voice = await addVoice({
      name: 'Narrator',
      kind: 'preset',
      presetName: 'vivian',
      instruct: 'calm and clear',
    });

    expect(voice.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(voice.createdAt).toEqual(expect.any(String));
    expect(voice).toMatchObject({
      name: 'Narrator',
      kind: 'preset',
      presetName: 'vivian',
      instruct: 'calm and clear',
    });
    await expect(loadVoices()).resolves.toEqual([voice]);
  });

  it('deletes voices by id and reports unknown ids', async () => {
    const first = await addVoice({ name: 'First', kind: 'design', description: 'warm' });
    const second = await addVoice({ name: 'Second', kind: 'clone', embedding: [0.1, 0.2] });

    await expect(deleteVoice(first.id)).resolves.toBe(true);
    await expect(deleteVoice('missing')).resolves.toBe(false);
    await expect(loadVoices()).resolves.toEqual([second]);
  });

  it('clears all voices with one library rewrite', async () => {
    await addVoice({ name: 'First', kind: 'preset', presetName: 'vivian' });
    await addVoice({ name: 'Second', kind: 'clone', embedding: [0.1, 0.2] });

    await expect(clearVoices()).resolves.toBe(2);
    await expect(clearVoices()).resolves.toBe(0);
    await expect(loadVoices()).resolves.toEqual([]);
  });

  it('finds voices by id and name after addVoice', async () => {
    const voice = await addVoice({ name: 'Status', kind: 'clone', embedding: [1, 2, 3] });

    await expect(findVoiceById(voice.id)).resolves.toEqual(voice);
    await expect(findVoiceByName('Status')).resolves.toEqual(voice);
    await expect(findVoiceById('missing')).resolves.toBeUndefined();
    await expect(findVoiceByName('Missing')).resolves.toBeUndefined();
  });

  it('saves embeddings in the separate voice library file with owner-only permissions', async () => {
    await saveVoices([
      {
        id: 'voice-id',
        name: 'Clone',
        kind: 'clone',
        createdAt: '2026-05-16T00:00:00.000Z',
        embedding: [0.1, 0.2, 0.3],
      },
    ]);

    const written = await readFile(getTtsVoicesPath(), 'utf-8');
    const mode = (await stat(getTtsVoicesPath())).mode & 0o777;
    expect(written).toContain('"embedding"');
    expect(written).toContain('0.2');
    expect(mode).toBe(0o600);
  });
});
