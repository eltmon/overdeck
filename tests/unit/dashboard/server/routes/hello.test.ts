import { describe, expect, it } from 'vitest';

import { HELLO_HTML, helloResponse } from '../../../../../src/dashboard/server/routes/hello.js';

describe('GET /hello', () => {
  it('returns the exact hello HTML as text/html', () => {
    expect(helloResponse.status).toBe(200);
    expect(helloResponse.headers['content-type']).toBe('text/html');
    expect(helloResponse.body._tag).toBe('Uint8Array');
    expect(helloResponse.body.contentType).toBe('text/html');
    expect(new TextDecoder().decode(helloResponse.body.body as Uint8Array)).toBe(HELLO_HTML);
  });
});
