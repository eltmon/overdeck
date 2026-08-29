export const PRIME_AGENT_HOST_MAX_REQUEST_BYTES = 1024 * 1024;
export const PRIME_AGENT_HOST_MAX_CONCURRENT_REQUESTS = 8;

export class PrimeAgentHostRequestTooLarge extends Error {
  constructor() {
    super(`Prime Agent host request exceeds ${PRIME_AGENT_HOST_MAX_REQUEST_BYTES} bytes`);
    this.name = 'PrimeAgentHostRequestTooLarge';
  }
}

export async function readPrimeAgentHostRequest(
  input: AsyncIterable<Uint8Array>,
  contentLength?: string,
): Promise<Record<string, unknown>> {
  if (contentLength && Number(contentLength) > PRIME_AGENT_HOST_MAX_REQUEST_BYTES) {
    throw new PrimeAgentHostRequestTooLarge();
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of input) {
    received += chunk.byteLength;
    if (received > PRIME_AGENT_HOST_MAX_REQUEST_BYTES) throw new PrimeAgentHostRequestTooLarge();
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks, received).toString('utf8')) as Record<string, unknown>;
}
