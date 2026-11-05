import { describe, expect, it } from 'vitest';
import { parseProjectMcpServers } from '../../../../src/lib/projects/project-mcp.js';

function parse(raw: unknown) {
  const warnings: string[] = [];
  const servers = parseProjectMcpServers(raw, 'acme', (line) => warnings.push(line));
  return { servers, warnings };
}

const validStdio = { linear: { type: 'stdio', command: 'npx', args: ['-y', 'linear-mcp'], env: { LINEAR_API_KEY: '${ACME_LINEAR_KEY}' } } };

describe('parseProjectMcpServers (PAN-5061 WI-1)', () => {
  it('returns {} without a warning when mcp_servers is absent', () => {
    expect(parse(undefined)).toEqual({ servers: {}, warnings: [] });
  });

  it('accepts a valid stdio entry', () => {
    const { servers, warnings } = parse([validStdio]);
    expect(warnings).toEqual([]);
    expect(servers).toEqual({
      linear: { type: 'stdio', command: 'npx', args: ['-y', 'linear-mcp'], env: { LINEAR_API_KEY: '${ACME_LINEAR_KEY}' } },
    });
  });

  it('defaults type to stdio and fills empty args and env', () => {
    const { servers, warnings } = parse([{ fs: { command: 'mcp-fs' } }]);
    expect(warnings).toEqual([]);
    expect(servers).toEqual({ fs: { type: 'stdio', command: 'mcp-fs', args: [], env: {} } });
  });

  it('accepts a valid http entry, including a localhost http url', () => {
    const { servers, warnings } = parse([
      { sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp', headers: { Authorization: 'Bearer ${SENTRY_TOKEN}' } } },
      { local: { type: 'http', url: 'http://127.0.0.1:8080/mcp' } },
      { local2: { type: 'http', url: 'http://localhost:9000/mcp' } },
    ]);
    expect(warnings).toEqual([]);
    expect(servers.sentry).toEqual({ type: 'http', url: 'https://mcp.sentry.dev/mcp', headers: { Authorization: 'Bearer ${SENTRY_TOKEN}' } });
    expect(servers.local).toEqual({ type: 'http', url: 'http://127.0.0.1:8080/mcp', headers: {} });
    expect(servers.local2?.type).toBe('http');
  });

  it('rejects a plain map instead of a list', () => {
    const { servers, warnings } = parse(validStdio);
    expect(servers).toEqual({});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('[project-mcp] acme:');
    expect(warnings[0]).toContain('expected a list of single-key maps');
  });

  it('skips a multi-key element and keeps valid siblings', () => {
    const { servers, warnings } = parse([{ a: { command: 'x' }, b: { command: 'y' } }, validStdio]);
    expect(Object.keys(servers)).toEqual(['linear']);
    expect(warnings).toEqual(['[project-mcp] acme: server #1 skipped: each list element must be a single-key map']);
  });

  it('skips a bad name and keeps valid siblings', () => {
    const { servers, warnings } = parse([{ 'bad name!': { command: 'x' } }, validStdio]);
    expect(Object.keys(servers)).toEqual(['linear']);
    expect(warnings).toEqual(['[project-mcp] acme: server bad name! skipped: name must match ^[A-Za-z0-9_-]+$']);
  });

  it('rejects the reserved overdeck name and keeps the stdio entry', () => {
    const { servers, warnings } = parse([validStdio, { overdeck: { command: 'evil' } }]);
    expect(Object.keys(servers)).toEqual(['linear']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toBe('[project-mcp] acme: server overdeck skipped: the name overdeck is reserved');
  });

  it('rejects an http url that is not https or localhost and keeps the https sibling', () => {
    const { servers, warnings } = parse([
      { insecure: { type: 'http', url: 'http://example.com/mcp' } },
      { secure: { type: 'http', url: 'https://example.com/mcp' } },
    ]);
    expect(Object.keys(servers)).toEqual(['secure']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^\[project-mcp\] acme: server insecure skipped: url must start with https:\/\//);
  });

  it('rejects a lookalike localhost host', () => {
    const { servers } = parse([{ x: { type: 'http', url: 'http://localhost.evil.com/mcp' } }]);
    expect(servers).toEqual({});
  });

  it('keeps the first entry for a duplicate name', () => {
    const { servers, warnings } = parse([{ fs: { command: 'first' } }, { fs: { command: 'second' } }]);
    expect(servers.fs).toEqual({ type: 'stdio', command: 'first', args: [], env: {} });
    expect(warnings).toEqual(['[project-mcp] acme: server fs skipped: duplicate name (the first entry is kept)']);
  });

  it('rejects a non-string arg and keeps valid siblings', () => {
    const { servers, warnings } = parse([{ fs: { command: 'mcp-fs', args: ['--port', 8080] } }, validStdio]);
    expect(Object.keys(servers)).toEqual(['linear']);
    expect(warnings).toEqual(['[project-mcp] acme: server fs skipped: args must be a list of strings']);
  });

  it('rejects an unknown type, a missing command and a non-string env value', () => {
    const { servers, warnings } = parse([
      { a: { type: 'sse', url: 'https://x' } },
      { b: { args: ['x'] } },
      { c: { command: 'x', env: { PORT: 1 } } },
    ]);
    expect(servers).toEqual({});
    expect(warnings).toEqual([
      '[project-mcp] acme: server a skipped: type must be stdio or http',
      '[project-mcp] acme: server b skipped: command must be a non-empty string',
      '[project-mcp] acme: server c skipped: env must be a map of strings',
    ]);
  });

  it('never puts a value in a warning', () => {
    const { warnings } = parse([{ h: { type: 'http', url: 'https://x', headers: { Authorization: 42, Token: 'sk-SECRET-VALUE' } } }]);
    expect(warnings).toHaveLength(1);
    expect(warnings.join('\n')).not.toContain('sk-SECRET-VALUE');
  });
});
