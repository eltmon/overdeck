/** JSON-RPC `tools/call` client for the Overdeck MCP endpoint (PAN-4954 WI-3, NFR-1, NFR-4;
 * PAN-4927 W-INT2). The endpoint is sessionless and answers JSON, so one POST per call is enough.
 * Errors name at most `url.origin` and never the token. Timeouts use AbortController plus
 * setTimeout, because AbortSignal.timeout ignores fake timers. */

export const TOOL_TIMEOUT_MS = 10_000;

export class OverdeckMcpError extends Error {}

export interface McpCallResult { isError: boolean; text: string }

export interface McpClient { callTool(name: string, args: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<McpCallResult> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createMcpClient(input: { url: URL; token: string; fetch?: typeof fetch }): McpClient {
  const { url, token } = input;
  const doFetch = input.fetch ?? fetch;
  let nextId = 1;

  return {
    async callTool(name, args, opts) {
      const timeoutMs = opts?.timeoutMs ?? TOOL_TIMEOUT_MS;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      let bodyText: string;
      try {
        try {
          response = await doFetch(url.href, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
            signal: controller.signal,
          });
          bodyText = await response.text();
        } catch {
          if (controller.signal.aborted) throw new OverdeckMcpError(`Overdeck did not answer within ${timeoutMs / 1000} s`);
          throw new OverdeckMcpError(`Cannot reach Overdeck at ${url.origin}`);
        }
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 401) throw new OverdeckMcpError('Overdeck refused the token (HTTP 401). Check localToken.');
      if (!response.ok) throw new OverdeckMcpError(`Overdeck MCP request failed (HTTP ${response.status})`);

      let body: unknown;
      try {
        body = JSON.parse(bodyText);
      } catch {
        throw new OverdeckMcpError('Overdeck answered with something that is not JSON');
      }
      if (isRecord(body) && isRecord(body.error)) {
        const message = typeof body.error.message === 'string' ? body.error.message : 'unknown error';
        throw new OverdeckMcpError(`Overdeck MCP error: ${message.slice(0, 300)}`);
      }
      if (!isRecord(body) || !isRecord(body.result)) throw new OverdeckMcpError('Overdeck answered without a result');

      const content = Array.isArray(body.result.content) ? body.result.content : [];
      const text = content
        .filter((block): block is { type: 'text'; text: string } => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n');
      return { isError: body.result.isError === true, text };
    },
  };
}
