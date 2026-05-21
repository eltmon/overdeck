/**
 * Workaround for Effect 4.0.0-beta.45 bug where HttpServerResponse.json()
 * creates a response without a proper body._tag, causing NodeHttpServer to crash
 * with "undefined is not an object (evaluating 'body._tag')".
 * 
 * HttpServerResponse.text() works fine, so we use it with manual JSON.stringify.
 * Remove this workaround when Effect stabilizes HttpServerResponse.json().
 */
import { HttpServerResponse } from 'effect/unstable/http';

export function jsonResponse(
  data: unknown,
  options?: number | { status?: number; headers?: Record<string, string> },
): HttpServerResponse.HttpServerResponse {
  const opts = typeof options === 'number' ? { status: options } : options;
  return HttpServerResponse.text(
    JSON.stringify(data),
    {
      status: opts?.status ?? 200,
      contentType: 'application/json',
      headers: opts?.headers,
    }
  );
}
