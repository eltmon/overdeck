/**
 * Pairing-link parsing and the transport policy for a chosen machine.
 *
 * Pure: no Electron import. The DNS lookup is injected so the policy can be
 * tested without network; production passes `dns.promises.lookup(host, { all: true })`.
 *
 * Transport policy (PAN-4402 D-5): the device token travels only over HTTPS,
 * this computer's loopback, or a Tailscale address (WireGuard encrypts the tailnet).
 */

import { BlockList, isIP } from "node:net";

export interface PairingLink {
  baseUrl: string;
  credential: string;
}

export type ParseResult = { ok: true; link: PairingLink } | { ok: false; error: string };

export type LookupAll = (host: string) => Promise<string[]>;

export type TransportVerdict =
  | { ok: true; kind: "https" | "loopback" | "tailnet" }
  | { ok: false; error: string };

export const BARE_CREDENTIAL_ERROR = "Paste the whole pairing link, including the address.";
export const NOT_A_LINK_ERROR = "That is not an Overdeck pairing link.";
export const TRANSPORT_REFUSED_ERROR =
  "Overdeck sends this computer's credential only over HTTPS, Tailscale or this computer's loopback. Use the machine's Tailscale address or an HTTPS address.";

const tailnet = new BlockList();
tailnet.addSubnet("100.64.0.0", 10, "ipv4");
tailnet.addSubnet("fd7a:115c:a1e0::", 48, "ipv6");

const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

function inList(list: BlockList, ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return list.check(ip, "ipv4");
  if (family === 6) return list.check(ip, "ipv6");
  return false;
}

/** True for 100.64.0.0/10 and fd7a:115c:a1e0::/48. */
export function isTailnetAddress(ip: string): boolean {
  return inList(tailnet, ip);
}

/** True for 127.0.0.0/8 and ::1. */
export function isLoopbackAddress(ip: string): boolean {
  return inList(loopback, ip);
}

export function parsePairingLink(input: string): ParseResult {
  const text = input.trim();
  if (text.startsWith("odp_")) return { ok: false, error: BARE_CREDENTIAL_ERROR };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: NOT_A_LINK_ERROR };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: NOT_A_LINK_ERROR };
  }

  const credential = new URLSearchParams(url.hash.slice(1)).get("pair");
  if (!credential || !credential.startsWith("odp_")) {
    return { ok: false, error: NOT_A_LINK_ERROR };
  }
  return { ok: true, link: { baseUrl: url.origin, credential } };
}

export async function assessMachineTransport(
  baseUrl: string,
  lookupAll: LookupAll,
): Promise<TransportVerdict> {
  const refused: TransportVerdict = { ok: false, error: TRANSPORT_REFUSED_ERROR };

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return refused;
  }
  if (url.protocol === "https:") return { ok: true, kind: "https" };
  if (url.protocol !== "http:") return refused;

  // IPv6 literals arrive bracketed in URL.hostname ("[::1]").
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (host === "localhost" || isLoopbackAddress(host)) return { ok: true, kind: "loopback" };
  if (isTailnetAddress(host) || host.endsWith(".ts.net")) return { ok: true, kind: "tailnet" };
  if (isIP(host) !== 0) return refused;

  let addresses: string[];
  try {
    addresses = await lookupAll(host);
  } catch {
    return refused;
  }
  if (addresses.length === 0) return refused;
  if (addresses.every(isTailnetAddress)) return { ok: true, kind: "tailnet" };
  if (addresses.every(isLoopbackAddress)) return { ok: true, kind: "loopback" };
  return refused;
}
