/**
 * Whether a Codex rollout's newest turn is still running (PAN-3920 W2).
 *
 * Reads only the rollout's last 128 KiB and walks it backwards to the newest
 * `task_started` / `task_complete` / `turn_aborted` event. Lives in `src/lib`
 * so lib modules can ask without importing dashboard-server code.
 *
 * Opens with O_NONBLOCK and refuses anything but a regular file, so a path
 * that names a FIFO can never block the caller (PAN-3920 #4038 review).
 */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue {
  if (typeof value === 'string') {
    try { return object(JSON.parse(value)); } catch { return {}; }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
}

export async function codexThreadStatus(file: string): Promise<'running' | 'done'> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`${file} is not a regular file`);
    const { size } = info;
    const start = Math.max(0, size - 128 * 1024);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    for (const line of lines.reverse()) {
      const entry = object(line);
      if (entry.type !== 'event_msg') continue;
      const payload = object(entry.payload);
      if (payload.type === 'task_complete' || payload.type === 'turn_aborted') return 'done';
      if (payload.type === 'task_started') return 'running';
    }
    return 'running';
  } finally { await handle.close(); }
}
