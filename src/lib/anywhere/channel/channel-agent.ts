/**
 * One keep-alive `http.Agent` per secure channel (PAN-4645).
 *
 * A plain `http.request({ createConnection })` has no agent, so Node sends
 * `Connection: close`; the peer's HTTP server then ends the channel after the
 * first response and a second request on the same channel writes into a dead
 * stream and never completes. Every HTTP client that speaks over a channel
 * (`channelRequest`, the heartbeat stream) therefore goes through this agent:
 * `maxSockets: 1` keeps requests on one channel sequential, and the agent is
 * destroyed with the channel.
 */
import { Agent as HttpAgent } from 'node:http';
import type { Socket } from 'node:net';

import type { ChannelSocket } from './channel-socket.js';

const agents = new WeakMap<ChannelSocket, HttpAgent>();

export function channelAgent(channel: ChannelSocket): HttpAgent {
  const existing = agents.get(channel);
  if (existing) return existing;
  const agent = new HttpAgent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 });
  agent.createConnection = ((_options: unknown, callback?: (error: Error | null, socket: Socket) => void) => {
    if (channel.destroyed) {
      const error = new Error('the channel is closed');
      if (callback) {
        callback(error, undefined as unknown as Socket);
        return undefined;
      }
      throw error;
    }
    return channel as unknown as Socket;
  }) as unknown as HttpAgent['createConnection'];
  channel.once('close', () => {
    agent.destroy();
    agents.delete(channel);
  });
  agents.set(channel, agent);
  return agent;
}
