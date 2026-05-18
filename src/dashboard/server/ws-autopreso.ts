import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { autoPresoSession } from '../../autopreso/session.js';
import { boundedAutoPresoElements } from '../../autopreso/limits.js';
import { isTrustedOriginForHost } from './routes/origin-validation.js';

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function boundedSnapshotPayload(type: 'whiteboard:snapshot' | 'whiteboard:update') {
  const snapshot = autoPresoSession.snapshot();
  return { type, ...snapshot, elements: boundedAutoPresoElements(snapshot.elements) };
}

function isTrustedWebSocketOrigin(request: http.IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== 'string') return false;
  return isTrustedOriginForHost(origin, request.headers.host);
}

export function setupAutoPresoWebSocket(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });
  const originalOn = server.on.bind(server);

  server.on = function(event: string, listener: (...args: unknown[]) => void) {
    if (event === 'upgrade') {
      const wrapped = (request: http.IncomingMessage, socket: import('net').Socket, head: Buffer) => {
        const url = new URL(request.url || '', `http://${request.headers.host}`);
        if (url.pathname === '/ws/autopreso') return;
        (listener as (req: http.IncomingMessage, socket: import('net').Socket, head: Buffer) => void)(request, socket, head);
      };
      return originalOn(event, wrapped as never);
    }
    return originalOn(event, listener as never);
  } as typeof server.on;

  originalOn('upgrade', (request: http.IncomingMessage, socket: import('net').Socket, head: Buffer) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.pathname !== '/ws/autopreso') return;
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
    sendJson(ws, boundedSnapshotPayload('whiteboard:snapshot'));
    const unsubscribe = autoPresoSession.subscribe(() => {
      sendJson(ws, boundedSnapshotPayload('whiteboard:update'));
    });
    ws.on('close', unsubscribe);
    ws.on('error', unsubscribe);
  });
}
