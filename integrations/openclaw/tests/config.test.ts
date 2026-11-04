import { describe, expect, it } from 'vitest';
import { checkConnectorUrl, DEFAULT_CONNECTOR_URL, readConfig } from '../src/config.js';

describe('readConfig', () => {
  it.each([undefined, {}])('applies the defaults to %j', (raw) => {
    expect(readConfig(raw)).toEqual({ connectorUrl: DEFAULT_CONNECTOR_URL, localToken: null, summary: true, allowAnswers: false });
  });

  it('trims the URL and the token', () => {
    const config = readConfig({ connectorUrl: '  https://box.tail1.ts.net/mcp ', localToken: ' tok ' });
    expect(config.connectorUrl).toBe('https://box.tail1.ts.net/mcp');
    expect(config.localToken).toBe('tok');
  });

  it('reads an empty URL as the default', () => {
    expect(readConfig({ connectorUrl: '   ' }).connectorUrl).toBe(DEFAULT_CONNECTOR_URL);
  });

  it('reads an unresolved env reference as no token', () => {
    expect(readConfig({ localToken: '${OVERDECK_CONNECTOR_LOCAL_TOKEN}' }).localToken).toBeNull();
  });

  it('reads only exact booleans', () => {
    expect(readConfig({ allowAnswers: 'true' }).allowAnswers).toBe(false);
    expect(readConfig({ allowAnswers: true }).allowAnswers).toBe(true);
    expect(readConfig({ summary: 'false' }).summary).toBe(true);
    expect(readConfig({ summary: false }).summary).toBe(false);
  });
});

describe('checkConnectorUrl', () => {
  it.each([
    'http://127.0.0.1:7466/mcp',
    'http://localhost:7466/mcp',
    'http://[::1]:7466/mcp',
    'https://box.tail1.ts.net/mcp',
  ])('accepts %s', (value) => {
    const check = checkConnectorUrl(value);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.url.href).toBe(new URL(value).href);
  });

  it.each([
    'http://example.com/mcp',
    'http://localhost.example.com/mcp',
    'http://127.0.0.1.nip.io/mcp',
    'ftp://127.0.0.1/mcp',
    'https://user:pw@box.tail1.ts.net/mcp',
    'not a url',
  ])('refuses %s without echoing it', (value) => {
    const check = checkConnectorUrl(value);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).not.toContain(value);
      for (const part of ['example.com', 'nip.io', 'user:pw', 'tail1', 'not a url', 'ftp:']) {
        if (value.includes(part)) expect(check.reason).not.toContain(part);
      }
    }
  });
});
