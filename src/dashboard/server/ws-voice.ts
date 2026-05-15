import http from 'node:http';
import { Buffer } from 'node:buffer';
import { WebSocket, WebSocketServer } from 'ws';
import { autoPresoSession } from '../../autopreso/session.js';
import { createTranscriptionManager, type TranscriptionManager } from '../../voice/transcription-manager.js';
import { createTurnQueue, type TurnQueue } from '../../voice/turn-queue.js';
import { loadVoiceSettings, subscribeVoiceSettings } from './routes/voice.js';
import { isTrustedOriginForHost } from './routes/origin-validation.js';

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function rawDataToBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

const MAX_AUDIO_FRAME_BYTES = 64_000;

function isTrustedWebSocketOrigin(request: http.IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== 'string') return false;
  return isTrustedOriginForHost(origin, request.headers.host);
}

export function setupVoiceWebSocket(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });
  const originalOn = server.on.bind(server);

  server.on = function(event: string, listener: (...args: unknown[]) => void) {
    if (event === 'upgrade') {
      const wrapped = (request: http.IncomingMessage, socket: import('net').Socket, head: Buffer) => {
        const url = new URL(request.url || '', `http://${request.headers.host}`);
        if (url.pathname === '/ws/voice') return;
        (listener as (req: http.IncomingMessage, socket: import('net').Socket, head: Buffer) => void)(request, socket, head);
      };
      return originalOn(event, wrapped as never);
    }
    return originalOn(event, listener as never);
  } as typeof server.on;

  originalOn('upgrade', (request: http.IncomingMessage, socket: import('net').Socket, head: Buffer) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.pathname !== '/ws/voice') return;
    if (!isTrustedWebSocketOrigin(request)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    let manager: TranscriptionManager | null = null;
    let turnQueue: TurnQueue | null = null;

    const configureTranscription = async (nextSettings?: Awaited<ReturnType<typeof loadVoiceSettings>>) => {
      const settings = nextSettings ?? await loadVoiceSettings();
      if (ws.readyState !== WebSocket.OPEN) return;
      turnQueue?.close();
      manager?.close();
      manager = createTranscriptionManager(settings);
      manager.applyCurrent();
      const transcription = manager.getActive();
      if (!transcription) throw new Error('Voice transcription unavailable');
      transcription.onPartial((text) => sendJson(ws, { type: 'transcript:partial', text }));
      turnQueue = createTurnQueue(transcription, (text) => {
        sendJson(ws, { type: 'transcript:committed', text });
        void autoPresoSession.processTranscript(text, settings).catch((error) => {
          sendJson(ws, { type: 'error', error: error instanceof Error ? error.message : String(error) });
        });
      });
      transcription.onError((error) => sendJson(ws, { type: 'error', error: error.message }));
    };

    const unsubscribeSettings = subscribeVoiceSettings((settings) => {
      void configureTranscription(settings).catch((error) => {
        sendJson(ws, { type: 'error', error: error instanceof Error ? error.message : String(error) });
      });
    });

    void configureTranscription()
      .catch((error) => {
        sendJson(ws, { type: 'error', error: error instanceof Error ? error.message : String(error) });
        ws.close(1011, 'Voice transcription unavailable');
      });

    ws.on('message', (data, isBinary) => {
      const transcription = manager?.getActive();
      if (!transcription) {
        sendJson(ws, { type: 'error', error: 'Voice transcription is not ready' });
        return;
      }
      if (isBinary) {
        const audio = rawDataToBuffer(data);
        if (audio.byteLength > MAX_AUDIO_FRAME_BYTES) {
          sendJson(ws, { type: 'error', error: 'Voice audio frame is too large' });
          ws.close(1009, 'Voice audio frame is too large');
          return;
        }
        if (!transcription.sendAudio(audio)) {
          sendJson(ws, { type: 'error', error: 'Voice transcription is backpressured' });
        }
        return;
      }

      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        sendJson(ws, { type: 'error', error: 'Invalid voice control message' });
        return;
      }

      if (message && typeof message === 'object' && 'type' in message && message.type === 'stop') {
        transcription.stop();
      }
    });

    const closeTranscription = () => {
      unsubscribeSettings();
      turnQueue?.close();
      turnQueue = null;
      manager?.close();
      manager = null;
    };

    ws.on('close', closeTranscription);
    ws.on('error', closeTranscription);
  });
}
