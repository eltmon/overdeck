import { describe, expect, it } from 'vitest';
import {
  PRIME_AGENT_HOST_MAX_REQUEST_BYTES,
  PrimeAgentHostRequestTooLarge,
  readPrimeAgentHostRequest,
} from '../host-http.js';

async function* chunks(...values: Uint8Array[]) { yield* values; }

describe('Prime Agent host request reader', () => {
  it('parses a bounded chunked JSON request', async () => {
    await expect(readPrimeAgentHostRequest(chunks(Buffer.from('{"op":'), Buffer.from('"stats"}'))))
      .resolves.toEqual({ op: 'stats' });
  });

  it('rejects oversized content-length before consuming the body', async () => {
    await expect(readPrimeAgentHostRequest(chunks(), String(PRIME_AGENT_HOST_MAX_REQUEST_BYTES + 1)))
      .rejects.toBeInstanceOf(PrimeAgentHostRequestTooLarge);
  });

  it('rejects a chunked body that crosses the byte cap', async () => {
    await expect(readPrimeAgentHostRequest(chunks(
      Buffer.alloc(PRIME_AGENT_HOST_MAX_REQUEST_BYTES),
      Buffer.from('x'),
    ))).rejects.toBeInstanceOf(PrimeAgentHostRequestTooLarge);
  });
});
