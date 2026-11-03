/** A `streamx` `Duplex` over a browser `WebSocket`, the CP-1 raw transport (PAN-4833 D-11). */
import { Duplex } from 'streamx';

type Callback = (error: Error | null) => void;

export class WsDuplex extends Duplex {
  constructor(private readonly socket: WebSocket) {
    super();
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (event: MessageEvent) => {
      this.push(new Uint8Array(event.data as ArrayBuffer));
    });
    socket.addEventListener('close', () => this.push(null));
  }

  override _open(cb: Callback): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      cb(null);
      return;
    }
    this.socket.addEventListener('open', () => cb(null), { once: true });
    this.socket.addEventListener('error', () => cb(new Error('WebSocket failed to open')), { once: true });
  }

  override _read(cb: Callback): void {
    cb(null);
  }

  override _write(data: unknown, cb: Callback): void {
    this.socket.send(data as Uint8Array<ArrayBuffer>);
    cb(null);
  }

  override _destroy(cb: Callback): void {
    this.socket.close();
    cb(null);
  }
}
