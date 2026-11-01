/**
 * Dashboard API client for the Overdeck MCP tool module (PAN-4649).
 *
 * Every MCP tool proxies to an existing dashboard HTTP route with the
 * caller's Bearer `odk_` token, so the route-scope table stays the only scope
 * authority and there is no second path to any operation (D-21). `/mcp` builds
 * this client against the dashboard's loopback URL; `pan mcp serve` builds it
 * against `getDashboardApiUrl()`.
 *
 * The token travels only in the `Authorization` header, never in a URL.
 */

export interface DashboardApiResponse {
  status: number;
  /** The parsed JSON body; `null` when the body is empty or not JSON. */
  json: unknown;
}

export interface DashboardApi {
  request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<DashboardApiResponse>;
}

/** fetch-based client: `${baseUrl}${path}` with `Authorization: Bearer <token>`; JSON body and Content-Type on POST. */
export function createFetchDashboardApi(input: { baseUrl: string; token: string; fetchImpl?: typeof fetch }): DashboardApi {
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    async request(method, path, body) {
      const headers: Record<string, string> = { Authorization: `Bearer ${input.token}`, Accept: 'application/json' };
      const init: RequestInit = { method, headers };
      if (method === 'POST') {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body ?? {});
      }
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, init);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Overdeck dashboard unreachable at ${baseUrl}: ${message}`);
      }
      const text = await response.text();
      let json: unknown = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      return { status: response.status, json };
    },
  };
}
