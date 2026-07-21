import { expect, vi } from 'vitest';

interface FetchRequest {
  url: string;
  method: string;
  input: RequestInfo | URL;
  init?: RequestInit;
}

type FetchHandler = (request: FetchRequest) => Response | Promise<Response> | undefined;

export function installStrictFetchMock(handler: FetchHandler) {
  const unexpectedRequests: string[] = [];
  const pendingRequests = new Set<Promise<Response>>();
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const requestPromise = Promise.resolve(handler({ url, method, input, init })).then((response) => {
      if (response) return response;

      const request = `${method} ${url}`;
      unexpectedRequests.push(request);
      throw new Error(`Unexpected network request: ${request}`);
    });
    pendingRequests.add(requestPromise);
    void requestPromise.then(
      () => pendingRequests.delete(requestPromise),
      () => pendingRequests.delete(requestPromise),
    );
    return requestPromise;
  });

  vi.stubGlobal('fetch', fetchMock);

  return {
    fetchMock,
    assertNoUnexpectedRequests: async () => {
      await Promise.allSettled([...pendingRequests]);
      expect(unexpectedRequests).toEqual([]);
    },
  };
}
