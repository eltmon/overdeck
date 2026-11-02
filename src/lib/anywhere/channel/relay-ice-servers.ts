/**
 * The relay route's ICE list (PAN-4862). werift 0.25.1 uses only the first TURN URL it finds, and a
 * blocked UDP allocation falls back to TCP only after ~6.35 s, so the order we pass decides whether a
 * relay can open inside RELAY_PROBE_TIMEOUT_MS. TLS first, then TCP, then UDP; STUN dropped, because the
 * responder would otherwise wait 5 s for a server-reflexive candidate on a UDP-blocked network.
 */
export interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** 0 = turns: on 443, 1 = other turns:, 2 = turn: over TCP, 3 = other turn:, null = not a TURN URL. */
export function turnUrlRank(url: string): number | null {
  const [authority = '', query = ''] = url.split('?', 2);
  const scheme = authority.slice(0, authority.indexOf(':') + 1).toLowerCase();
  if (scheme === 'turns:') {
    // No port means werift's default 5349.
    const port = /:(\d+)$/.exec(authority)?.[1];
    return port === '443' ? 0 : 1;
  }
  if (scheme === 'turn:') {
    const transport = new URLSearchParams(query).get('transport');
    return transport?.toLowerCase() === 'tcp' ? 2 : 3;
  }
  return null;
}

export function relayIceServers(servers: readonly RTCIceServerLike[]): RTCIceServerLike[] {
  const ranked: { server: RTCIceServerLike; best: number }[] = [];
  for (const server of servers) {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
      .map((url) => ({ url, rank: turnUrlRank(url) }))
      .filter((entry): entry is { url: string; rank: number } => entry.rank !== null)
      .sort((a, b) => a.rank - b.rank);
    const first = urls[0];
    if (!first) continue;
    const out: RTCIceServerLike = { urls: urls.map((entry) => entry.url) };
    if (server.username !== undefined) out.username = server.username;
    if (server.credential !== undefined) out.credential = server.credential;
    ranked.push({ server: out, best: first.rank });
  }
  if (ranked.length === 0) return [...servers];
  return ranked.sort((a, b) => a.best - b.best).map((entry) => entry.server);
}
