import http from 'node:http';
import { Buffer } from 'node:buffer';
import { WebSocket, WebSocketServer } from 'ws';
import { createMoonshineTranscription, type ITurnEmitter } from '../../voice/transcription.js';

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

function parseModel(request: http.IncomingMessage): string {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const model = url.searchParams.get('model')?.trim();
  return model === 'tiny' ? 'tiny' : 'base';
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
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket, request: http.IncomingMessage) => {
    let transcription: ITurnEmitter;
    try {
      transcription = createMoonshineTranscription(parseModel(request));
    } catch (error) {
      sendJson(ws, { type: 'error', error: error instanceof Error ? error.message : String(error) });
      ws.close(1011, 'Voice transcription unavailable');
      return;
    }

    transcription.onPartial((text) => sendJson(ws, { type: 'transcript:partial', text }));
    transcription.onCommitted((text) => sendJson(ws, { type: 'transcript:committed', text }));
    transcription.onError((error) => sendJson(ws, { type: 'error', error: error.message }));

    ws.on('message', (data, isBinary) => {
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

    ws.on('close', () => transcription.close());
    ws.on('error', () => transcription.close());
  });
}
