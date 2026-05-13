import http from 'node:http';
import { Buffer } from 'node:buffer';
import { WebSocket, WebSocketServer } from 'ws';
import { createTranscriptionManager, type TranscriptionManager } from '../../voice/transcription-manager.js';
import { loadVoiceSettings } from './routes/voice.js';
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
    void loadVoiceSettings()
      .then((settings) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        manager = createTranscriptionManager(settings);
        manager.applyCurrent();
        const transcription = manager.getActive();
        if (!transcription) throw new Error('Voice transcription unavailable');
        transcription.onPartial((text) => sendJson(ws, { type: 'transcript:partial', text }));
        transcription.onCommitted((text) => sendJson(ws, { type: 'transcript:committed', text }));
        transcription.onError((error) => sendJson(ws, { type: 'error', error: error.message }));
      })
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
        transcription.sendAudio(rawDataToBuffer(data));
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

    ws.on('close', () => manager?.close());
    ws.on('error', () => manager?.close());
  });
}
