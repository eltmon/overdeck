/**
 * macOS Local Network privacy (PAN-4897 WI-2, D-6, D-8): classifies which transport
 * routes a `tcp://` failure points at a LAN address, and builds the operator-facing
 * message that names the System Settings toggle to turn on. Pure, no I/O.
 */
import { isIPv4, isIPv6 } from 'node:net';

export const LOCAL_NETWORK_SETTINGS = 'System Settings → Privacy & Security → Local Network';

function isLanIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  if (a === 10) return true;
  if (a === 172 && b! >= 16 && b! <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** The first 16-bit group, resolving the `::` shorthand to 0 when it covers it. */
function firstHextet(address: string): number {
  const doubleColon = address.indexOf('::');
  const head = doubleColon === -1 ? address : address.slice(0, doubleColon);
  const group = head.split(':')[0];
  return group ? Number.parseInt(group, 16) : 0;
}

function isLanIPv6(address: string): boolean {
  const first = firstHextet(address);
  if (first >= 0xfe80 && first <= 0xfebf) return true; // fe80::/10
  if (first >= 0xfc00 && first <= 0xfdff) return true; // fc00::/7
  return false;
}

/** True only for an IP literal in a LAN range (10/8, 172.16/12, 192.168/16, 169.254/16, fe80::/10, fc00::/7). */
export function isLanAddress(host: string): boolean {
  const stripped = host.replace(/^\[|\]$/g, '');
  if (isIPv4(stripped)) return isLanIPv4(stripped);
  if (isIPv6(stripped)) return isLanIPv6(stripped);
  return false;
}

export interface RouteFailure {
  url: string;
  cause: string | undefined;
}

/** The `tcp://` route URLs whose host is a LAN address, only when every one of them failed with `EHOSTUNREACH`. */
export function lanHostUnreachableRoutes(failures: readonly RouteFailure[]): string[] {
  const lanFailures = failures.filter((failure) => failure.url.startsWith('tcp://') && isLanAddress(new URL(failure.url).hostname));
  if (lanFailures.length === 0) return [];
  if (!lanFailures.every((failure) => failure.cause === 'EHOSTUNREACH')) return [];
  return lanFailures.map((failure) => failure.url);
}

/** The operator-facing message naming the Local Network toggle and the blocked routes (D-6). */
export function localNetworkBlockedDetail(nodePath: string, routes: readonly string[]): string {
  return `macOS is blocking local network access for Overdeck. On this Mac, open ${LOCAL_NETWORK_SETTINGS} and turn on node (${nodePath}); `
    + `if you started Overdeck from a terminal app, turn that app on instead. The link retries on its own. `
    + `If node is not in the list, link over Tailscale (pan tailscale setup). Blocked routes: ${routes.join(', ')}`;
}
