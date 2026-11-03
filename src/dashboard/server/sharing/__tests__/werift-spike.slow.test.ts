/**
 * WebRTC dependency spike for Shared Sessions (PRD PAN-4474 WI-3, D-1, D-2). Opt-in:
 * `VITEST_INCLUDE_SLOW=1 npx vitest run src/dashboard/server/sharing/__tests__/werift-spike.slow.test.ts`.
 *
 * Measures werift ↔ werift throughput and ordering over real UDP on loopback, and checks werift ↔ a
 * real headless Chromium `RTCPeerConnection` with the five Shared Sessions channel labels and a
 * fragmented envelope. Real timers; every wait resolves on an event. The result is recorded in
 * `.pan/drafts/pan-658.md` under *WebRTC dependency*.
 */
import { SHARED_CHANNELS, encodeSharedMessage, type SharedEnvelope } from '@overdeck/contracts';
import { chromium, type Browser } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import { RTCPeerConnection, type RTCDataChannel } from 'werift';

const SPIKE_TIMEOUT_MS = 60_000;
const MESSAGE_CHARS = 16 * 1024;
const TOTAL_BYTES = 32 * 1024 * 1024;
const HIGH_WATER_BYTES = 1024 * 1024;
const LOW_WATER_BYTES = 256 * 1024;

const openPeers: RTCPeerConnection[] = [];
let browser: Browser | null = null;

/** What the Chromium page keeps on `window.spike` between evaluations. */
interface BrowserSpike {
  readonly channels: Map<string, globalThis.RTCDataChannel>;
  readonly ready: Promise<void>;
  waitForParts(expected: number): Promise<string[]>;
}

afterEach(async () => {
  for (const pc of openPeers.splice(0)) await pc.close().catch(() => undefined);
  await browser?.close();
  browser = null;
});

function peer(): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: [] });
  openPeers.push(pc);
  return pc;
}

/** Resolves once the peer has gathered every candidate, so its local description carries them all. */
function gathered(pc: RTCPeerConnection): Promise<string> {
  return new Promise((resolve) => {
    const done = (): void => resolve(pc.localDescription?.sdp ?? '');
    if (pc.iceGatheringState === 'complete') {
      done();
      return;
    }
    const { unSubscribe } = pc.iceGatheringStateChange.subscribe((state) => {
      if (state !== 'complete') return;
      unSubscribe();
      done();
    });
  });
}

function opened(channel: RTCDataChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    if (channel.readyState === 'open') {
      resolve();
      return;
    }
    const { unSubscribe } = channel.stateChanged.subscribe((state) => {
      if (state === 'open') {
        unSubscribe();
        resolve();
      } else if (state === 'closed') {
        unSubscribe();
        reject(new Error(`channel ${channel.label} closed before it opened`));
      }
    });
  });
}

/** Two werift peers joined in-process (offer and answer carry the gathered candidates); one ordered reliable channel. */
async function weriftPair(): Promise<{ sender: RTCDataChannel; receiver: RTCDataChannel }> {
  const offerer = peer();
  const answerer = peer();
  const sender = offerer.createDataChannel('spike', { ordered: true });
  const received = new Promise<RTCDataChannel>((resolve) => {
    answerer.onDataChannel.subscribe((channel) => resolve(channel));
  });
  await offerer.setLocalDescription(await offerer.createOffer());
  await answerer.setRemoteDescription({ type: 'offer', sdp: await gathered(offerer) });
  await answerer.setLocalDescription(await answerer.createAnswer());
  await offerer.setRemoteDescription({ type: 'answer', sdp: await gathered(answerer) });
  const receiver = await received;
  await Promise.all([opened(sender), opened(receiver)]);
  return { sender, receiver };
}

function drained(channel: RTCDataChannel): Promise<void> {
  return new Promise((resolve) => {
    const { unSubscribe } = channel.bufferedAmountLow.subscribe(() => {
      unSubscribe();
      resolve();
    });
  });
}

describe('werift spike (PAN-4474 WI-3)', () => {
  it('moves 32 MiB of 16 KiB messages intact and reports the throughput', async () => {
    const { sender, receiver } = await weriftPair();
    sender.bufferedAmountLowThreshold = LOW_WATER_BYTES;
    const messageCount = TOTAL_BYTES / MESSAGE_CHARS;
    const messages = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i).repeat(MESSAGE_CHARS));
    let receivedCount = 0;
    let corrupt = 0;
    const done = new Promise<void>((resolve) => {
      receiver.onMessage.subscribe((data) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        if (text !== messages[receivedCount % 26]) corrupt++;
        receivedCount++;
        if (receivedCount === messageCount) resolve();
      });
    });
    const started = performance.now();
    for (let i = 0; i < messageCount; i++) {
      if (sender.bufferedAmount > HIGH_WATER_BYTES) await drained(sender);
      sender.send(messages[i % 26] as string);
    }
    await done;
    const seconds = (performance.now() - started) / 1000;
    const mbps = TOTAL_BYTES / (1024 * 1024) / seconds;
    console.info(`[werift-spike] throughput ${mbps.toFixed(1)} MB/s (${seconds.toFixed(2)} s for 32 MiB)`);
    expect(corrupt).toBe(0);
    expect(receivedCount).toBe(messageCount);
    expect(mbps, `measured ${mbps.toFixed(1)} MB/s`).toBeGreaterThanOrEqual(1);
  }, SPIKE_TIMEOUT_MS);

  it('delivers 1000 messages in order', async () => {
    const { sender, receiver } = await weriftPair();
    const received: string[] = [];
    const done = new Promise<void>((resolve) => {
      receiver.onMessage.subscribe((data) => {
        received.push(typeof data === 'string' ? data : data.toString('utf8'));
        if (received.length === 1000) resolve();
      });
    });
    for (let i = 0; i < 1000; i++) sender.send(`m${i}`);
    await done;
    expect(received).toEqual(Array.from({ length: 1000 }, (_, i) => `m${i}`));
  }, SPIKE_TIMEOUT_MS);

  it('interoperates with a headless Chromium RTCPeerConnection on all five channels', async () => {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pc = peer();
    const channels = new Map<string, RTCDataChannel>();
    for (const label of SHARED_CHANNELS) channels.set(label, pc.createDataChannel(label, { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    const offerSdp = await gathered(pc);

    const answerSdp = await page.evaluate(
      async ({ sdp, count }: { sdp: string; count: number }) => {
        const remote = new globalThis.RTCPeerConnection({ iceServers: [] });
        const channels = new Map<string, globalThis.RTCDataChannel>();
        const parts: string[] = [];
        let onPart: (() => void) | null = null;
        const ready = new Promise<void>((resolve) => {
          let openCount = 0;
          const countOpen = (): void => {
            if (++openCount === count) resolve();
          };
          remote.ondatachannel = (event) => {
            const channel = event.channel;
            channels.set(channel.label, channel);
            if (channel.label === 'conversation') {
              channel.onmessage = (message) => {
                parts.push(String(message.data));
                onPart?.();
              };
            }
            if (channel.readyState === 'open') countOpen();
            else channel.addEventListener('open', countOpen, { once: true });
          };
        });
        const waitForParts = async (expected: number): Promise<string[]> => {
          while (parts.length < expected) await new Promise<void>((resolve) => (onPart = resolve));
          return parts;
        };
        (window as unknown as { spike: unknown }).spike = { remote, channels, ready, waitForParts };
        await remote.setRemoteDescription({ type: 'offer', sdp });
        await remote.setLocalDescription(await remote.createAnswer());
        if (remote.iceGatheringState !== 'complete') {
          await new Promise<void>((resolve) => {
            remote.onicegatheringstatechange = () => {
              if (remote.iceGatheringState === 'complete') resolve();
            };
          });
        }
        return remote.localDescription?.sdp ?? '';
      },
      { sdp: offerSdp, count: SHARED_CHANNELS.length },
    );

    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    await Promise.all([...channels.values()].map(opened));

    const labels = await page.evaluate(async () => {
      const spike = (window as unknown as { spike: BrowserSpike }).spike;
      await spike.ready;
      return [...spike.channels.keys()].sort();
    });
    expect(labels).toEqual([...SHARED_CHANNELS].sort());

    const text = 'x'.repeat(100_000);
    const envelope: SharedEnvelope = {
      v: 1,
      ch: 'conversation',
      streamId: 'spike',
      seq: 1,
      t: Date.now(),
      payload: { kind: 'append', message: { id: 'm1', role: 'assistant', text, createdAt: new Date().toISOString() } },
    };
    const parts = encodeSharedMessage(envelope, 1);
    expect(parts.length).toBeGreaterThan(1);
    const conversation = channels.get('conversation') as RTCDataChannel;
    for (const part of parts) conversation.send(part);

    const receivedLength = await page.evaluate(async (expected: number) => {
      const spike = (window as unknown as { spike: BrowserSpike }).spike;
      const received = await spike.waitForParts(expected);
      const rebuilt = JSON.parse(received.map((p) => (JSON.parse(p) as { data: string }).data).join('')) as {
        payload: { message: { text: string } };
      };
      return rebuilt.payload.message.text.length;
    }, parts.length);
    expect(receivedLength).toBe(text.length);

    const control = channels.get('control') as RTCDataChannel;
    const fromChromium = new Promise<string>((resolve) => {
      control.onMessage.subscribe((data) => resolve(typeof data === 'string' ? data : data.toString('utf8')));
    });
    await page.evaluate(() => {
      (window as unknown as { spike: BrowserSpike }).spike.channels.get('control')?.send('hello from chromium');
    });
    expect(await fromChromium).toBe('hello from chromium');
  }, SPIKE_TIMEOUT_MS);
});
