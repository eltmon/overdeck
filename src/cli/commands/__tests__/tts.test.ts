import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTtsSpeakPayload,
  DEFAULT_TTS_TEST_TEXT,
  deleteTtsVoiceByName,
  formatTtsDaemonStatus,
  formatVoiceDetails,
  formatVoicesTable,
  listTtsVoices,
  mapTtsVoice,
  playTtsVoice,
  runTtsDaemonStart,
  runTtsDaemonStatus,
  runTtsDaemonStop,
  runTtsTest,
  setDefaultTtsVoice,
  showTtsVoice,
} from '../tts.js';
import type { NormalizedTtsDaemonConfig } from '../../../lib/config-yaml.js';
import type { TtsVoice } from '../../../lib/tts-voices.js';

const CONFIG: NormalizedTtsDaemonConfig = {
  enabled: true,
  voice: 'voice-1',
  volume: 0.8,
  rate: 1.1,
  maxChars: 140,
  dropInfoWhenFull: true,
  daemonHost: '127.0.0.1',
  daemonPort: 8787,
  daemonAutoStart: false,
  voiceMap: {},
  mutedSources: [],
  utteranceTemplates: {},
  mutedIssues: [],
};

const PAYLOAD_CONTROLS = {
  rate: CONFIG.rate,
  maxChars: CONFIG.maxChars,
  dropInfoWhenFull: CONFIG.dropInfoWhenFull,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

const PRESET_VOICE: TtsVoice = {
  id: 'voice-1',
  name: 'System Voice',
  kind: 'preset',
  createdAt: '2026-05-16T00:00:00.000Z',
  presetName: 'Vivian',
  instruct: 'calm',
};

const DESIGN_VOICE: TtsVoice = {
  id: 'voice-2',
  name: 'Design Voice',
  kind: 'design',
  createdAt: '2026-05-16T00:00:00.000Z',
  description: 'warm narrator with crisp diction and fri cadence',
};

const CLONE_VOICE: TtsVoice = {
  id: 'voice-3',
  name: 'Clone Voice',
  kind: 'clone',
  createdAt: '2026-05-16T00:00:00.000Z',
  description: 'designed from warm narrator sample',
  embedding: [0.1, 0.2, 0.3],
};

describe('pan tts voices', () => {
  it('prints a table of all saved voices', async () => {
    const stdout = { log: vi.fn() };
    const voices = await listTtsVoices({
      loadVoices: vi.fn().mockResolvedValue([PRESET_VOICE, DESIGN_VOICE, CLONE_VOICE]),
      stdout,
    });

    expect(voices).toEqual([PRESET_VOICE, DESIGN_VOICE, CLONE_VOICE]);
    const output = stdout.log.mock.calls[0][0] as string;
    expect(output).toContain('NAME');
    expect(output).toContain('KIND');
    expect(output).toContain('MODEL/SOURCE');
    expect(output).toContain('System Voice');
    expect(output).toContain('preset');
    expect(output).toContain('Vivian');
    expect(output).toContain('warm narrator with crisp diction and fri');
    expect(output).toContain('embedding (designed from designed from warm narrator sa)');
  });

  it('prints the empty library message', async () => {
    const stdout = { log: vi.fn() };
    await listTtsVoices({ loadVoices: vi.fn().mockResolvedValue([]), stdout });

    expect(stdout.log).toHaveBeenCalledWith('No voices saved yet');
  });

  it('prints voice details without raw embedding values', async () => {
    const details = formatVoiceDetails(CLONE_VOICE);

    expect(details).toContain('"name": "Clone Voice"');
    expect(details).toContain('"embedding": "[3 floats]"');
    expect(details).not.toContain('0.1');
  });

  it('shows a voice by name', async () => {
    const stdout = { log: vi.fn() };
    const result = await showTtsVoice('Clone Voice', {
      findVoiceByName: vi.fn().mockResolvedValue(CLONE_VOICE),
      stdout,
      stderr: { error: vi.fn() },
    });

    expect(result).toEqual(CLONE_VOICE);
    expect(stdout.log).toHaveBeenCalledWith(formatVoiceDetails(CLONE_VOICE));
  });

  it('prints a not found error for unknown voices', async () => {
    const stderr = { error: vi.fn() };
    const result = await showTtsVoice('Missing', {
      findVoiceByName: vi.fn().mockResolvedValue(undefined),
      stdout: { log: vi.fn() },
      stderr,
    });

    expect(result).toBeUndefined();
    expect(stderr.error).toHaveBeenCalledWith(expect.stringContaining('Voice not found: Missing'));
  });

  it('formats the voices table without raw embedding values', () => {
    const output = formatVoicesTable([CLONE_VOICE]);

    expect(output).toContain('Clone Voice');
    expect(output).toContain('clone');
    expect(output).toContain('embedding (designed from designed from warm narrator sa)');
    expect(output).not.toContain('0.1');
  });

  it('plays a named voice through the daemon directly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"queued":true}', { status: 202 }));
    const result = await playTtsVoice('System Voice', 'custom phrase', {
      config: CONFIG,
      findVoiceByName: vi.fn().mockResolvedValue(PRESET_VOICE),
      fetch: fetchMock,
      stdout: { log: vi.fn() },
      stderr: { error: vi.fn() },
    });

    expect(result).toEqual({ ok: true, url: 'http://127.0.0.1:8787/speak' });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/speak', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'custom phrase', voice: 'Vivian', instruct: 'calm', volume: 0.8, ...PAYLOAD_CONTROLS, mode: 'custom' }),
    }));
  });

  it('deletes a named voice by id', async () => {
    const stdout = { log: vi.fn() };
    const deleteMock = vi.fn().mockResolvedValue(true);
    await expect(deleteTtsVoiceByName('System Voice', {
      findVoiceByName: vi.fn().mockResolvedValue(PRESET_VOICE),
      deleteVoice: deleteMock,
      stdout,
    })).resolves.toBe(true);

    expect(deleteMock).toHaveBeenCalledWith('voice-1');
    expect(stdout.log).toHaveBeenCalledWith('Deleted System Voice');
  });

  it('sets a named voice as the system default', async () => {
    const stdout = { log: vi.fn() };
    const updateMock = vi.fn().mockResolvedValue(undefined);
    await expect(setDefaultTtsVoice('System Voice', {
      findVoiceByName: vi.fn().mockResolvedValue(PRESET_VOICE),
      updateTtsConfig: updateMock,
      stdout,
    })).resolves.toEqual(PRESET_VOICE);

    expect(updateMock).toHaveBeenCalledWith({ voice: 'voice-1' });
    expect(stdout.log).toHaveBeenCalledWith('Set System Voice as system voice');
  });

  it('maps an event key to a named voice', async () => {
    const stdout = { log: vi.fn() };
    const updateMock = vi.fn().mockResolvedValue(undefined);
    await expect(mapTtsVoice('reviewStatus.passed', 'System Voice', {
      findVoiceByName: vi.fn().mockResolvedValue(PRESET_VOICE),
      updateTtsConfig: updateMock,
      stdout,
    })).resolves.toEqual(PRESET_VOICE);

    expect(updateMock).toHaveBeenCalledWith({ voiceMap: { 'reviewStatus.passed': 'voice-1' } });
    expect(stdout.log).toHaveBeenCalledWith('Mapped reviewStatus.passed → System Voice');
  });
});

describe('pan tts daemon lifecycle', () => {
  it('formats daemon status with pid, queue, model, uptime, and GPU memory', () => {
    const output = formatTtsDaemonStatus({
      ok: true,
      running: true,
      pid: 1234,
      daemonHost: '127.0.0.1',
      daemonPort: 8787,
      queueDepth: 2,
      model: 'qwen3-tts',
      uptimeSeconds: 65,
      gpuMemoryUsedMb: 4200,
    });

    expect(output).toContain('Daemon:');
    expect(output).toContain('Endpoint: 127.0.0.1:8787');
    expect(output).toContain('PID: 1234');
    expect(output).toContain('Model: qwen3-tts');
    expect(output).toContain('Queue depth: 2');
    expect(output).toContain('Uptime: 1m 5s');
    expect(output).toContain('GPU memory: 4.1GB');
  });

  it('starts the daemon through injected lifecycle dependencies', async () => {
    const startDaemon = vi.fn().mockResolvedValue({
      ok: true,
      pid: 1234,
      alreadyRunning: false,
      status: { ok: true, running: true, pid: 1234, daemonHost: '127.0.0.1', daemonPort: 8787 },
    });
    const stdout = { log: vi.fn() };

    const result = await runTtsDaemonStart({ waitForHealth: true, timeoutMs: 10 }, {
      config: CONFIG,
      startDaemon,
      stdout,
      stderr: { error: vi.fn() },
    });

    expect(result.ok).toBe(true);
    expect(startDaemon).toHaveBeenCalledWith({ config: CONFIG, detach: undefined, waitForHealth: true, timeoutMs: 10 });
    expect(stdout.log).toHaveBeenCalledWith(expect.stringContaining('TTS daemon started'));
  });

  it('stops the daemon through injected lifecycle dependencies', async () => {
    const stopDaemon = vi.fn().mockResolvedValue({ stopped: true, pid: 1234 });
    const stdout = { log: vi.fn() };

    const result = await runTtsDaemonStop({ stopDaemon, stdout, stderr: { error: vi.fn() } });

    expect(result).toEqual({ stopped: true, pid: 1234 });
    expect(stopDaemon).toHaveBeenCalledOnce();
    expect(stdout.log).toHaveBeenCalledWith(expect.stringContaining('Stopped TTS daemon'));
  });

  it('prints daemon status through injected lifecycle dependencies', async () => {
    const getStatus = vi.fn().mockResolvedValue({ ok: false, running: false, pid: null, daemonHost: '127.0.0.1', daemonPort: 8787, error: 'daemon unreachable' });
    const stdout = { log: vi.fn() };

    const result = await runTtsDaemonStatus({ config: CONFIG, getStatus, stdout });

    expect(result.ok).toBe(false);
    expect(getStatus).toHaveBeenCalledWith(CONFIG);
    expect(stdout.log).toHaveBeenCalledWith(expect.stringContaining('daemon unreachable'));
  });
});

describe('pan tts test', () => {
  it('builds daemon payloads for preset, design, and clone voices', () => {
    expect(buildTtsSpeakPayload(PRESET_VOICE, 'hello', CONFIG)).toEqual({
      text: 'hello',
      voice: 'Vivian',
      instruct: 'calm',
      volume: 0.8,
      ...PAYLOAD_CONTROLS,
      mode: 'custom',
    });

    expect(buildTtsSpeakPayload({ ...PRESET_VOICE, kind: 'design', description: 'warm narrator' }, 'hello', CONFIG)).toEqual({
      text: 'hello',
      voice: 'warm narrator',
      instruct: 'calm',
      volume: 0.8,
      ...PAYLOAD_CONTROLS,
      mode: 'design',
    });

    expect(buildTtsSpeakPayload({ ...PRESET_VOICE, kind: 'clone', embedding: [0.1, 0.2] }, 'hello', CONFIG)).toEqual({
      text: 'hello',
      voice: 'clone',
      instruct: 'calm',
      volume: 0.8,
      ...PAYLOAD_CONTROLS,
      mode: 'clone',
      embedding: [0.1, 0.2],
    });
  });

  it('posts the default phrase to the configured daemon using the system voice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"queued":true}', { status: 202 }));
    const result = await runTtsTest(undefined, {
      config: CONFIG,
      findVoiceById: vi.fn().mockResolvedValue(PRESET_VOICE),
      fetch: fetchMock,
      stdout: { log: vi.fn() },
      stderr: { error: vi.fn() },
    });

    expect(result).toEqual({ ok: true, url: 'http://127.0.0.1:8787/speak' });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/speak', {
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json', 'X-Panopticon-TTS-Token': expect.any(String) }),
      body: JSON.stringify({ text: DEFAULT_TTS_TEST_TEXT, voice: 'Vivian', instruct: 'calm', volume: 0.8, ...PAYLOAD_CONTROLS, mode: 'custom' }),
    });
  });

  it('posts through the daemon default preset when no system voice is configured', async () => {
    vi.stubEnv('QWEN_TTS_VOICE', 'Vivian');
    vi.stubEnv('QWEN_TTS_INSTRUCT', '');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"queued":true}', { status: 202 }));
    const findVoiceByIdMock = vi.fn();
    const result = await runTtsTest(undefined, {
      config: { ...CONFIG, voice: '' },
      findVoiceById: findVoiceByIdMock,
      fetch: fetchMock,
      stdout: { log: vi.fn() },
      stderr: { error: vi.fn() },
    });

    expect(result).toEqual({ ok: true, url: 'http://127.0.0.1:8787/speak' });
    expect(findVoiceByIdMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/speak', {
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json', 'X-Panopticon-TTS-Token': expect.any(String) }),
      body: JSON.stringify({ text: DEFAULT_TTS_TEST_TEXT, voice: 'Vivian', instruct: '', volume: 0.8, ...PAYLOAD_CONTROLS, mode: 'custom' }),
    });
  });

  it('prints an actionable error when the daemon is down', async () => {
    const stderr = { error: vi.fn() };
    const result = await runTtsTest('custom phrase', {
      config: CONFIG,
      findVoiceById: vi.fn().mockResolvedValue(PRESET_VOICE),
      fetch: vi.fn().mockRejectedValue(new TypeError('ECONNREFUSED')),
      stdout: { log: vi.fn() },
      stderr,
    });

    expect(result).toMatchObject({ ok: false, reason: 'daemon-unavailable' });
    expect(stderr.error).toHaveBeenCalledWith(expect.stringContaining('Daemon not running at 127.0.0.1:8787'));
  });
});
