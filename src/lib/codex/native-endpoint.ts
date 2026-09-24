/**
 * Where a conversation's Codex app-server exposes its native endpoint
 * (PAN-3835). Shared by the host that creates it and the companion adapter
 * that attaches the native TUI to it.
 *
 *   ~/.overdeck/agents/<agentId>/codex-native/        mode 0700
 *   ~/.overdeck/agents/<agentId>/codex-native/app.sock mode 0600 (codex app-server --listen)
 *   ~/.overdeck/agents/<agentId>/codex-native-endpoint the `unix://…` URL, written once the
 *                                                     host is connected, removed on stop
 */
import { join } from 'node:path';

const CODEX_NATIVE_SOCKET_DIR = 'codex-native';
const CODEX_NATIVE_SOCKET_NAME = 'app.sock';
export const CODEX_NATIVE_ENDPOINT_FILE = 'codex-native-endpoint';

export function codexNativeSocketPath(agentDir: string): string {
  return join(agentDir, CODEX_NATIVE_SOCKET_DIR, CODEX_NATIVE_SOCKET_NAME);
}
