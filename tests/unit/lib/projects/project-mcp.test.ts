import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PROJECTS_CONFIG_FILE, invalidateProjectsConfigCache } from '../../../../src/lib/projects.js';
import { parseProjectMcpServers, resolveProjectMcpServers } from '../../../../src/lib/projects/project-mcp.js';

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

// tests/setup/overdeck-home.ts points OVERDECK_HOME and HOME at per-worker temp dirs.
const ROOT = join(homedir(), 'pan-5061-project-mcp');
const SECRETS = join(ROOT, 'acme.env');

function writeAcme(projectYaml: string): void {
  writeFileSync(
    PROJECTS_CONFIG_FILE,
    `projects:\n  acme:\n    name: acme\n    path: ${join(ROOT, 'acme')}\n    issue_prefix: ACME\n` +
      `    workspace:\n      env:\n        secrets_file: ${SECRETS}\n${projectYaml}`,
  );
  invalidateProjectsConfigCache();
}

async function resolve(reservedNames: string[] = []) {
  const warnings: string[] = [];
  const result = await resolveProjectMcpServers({ issueId: 'ACME-7', reservedNames, warn: (line) => warnings.push(line) });
  return { ...result, warnings };
}

describe('resolveProjectMcpServers (PAN-5061 WI-3)', () => {
  beforeEach(() => {
    mkdirSync(join(ROOT, 'acme'), { recursive: true });
    writeFileSync(SECRETS, 'ACME_LINEAR_KEY=lin-from-secrets\nSHARED=from-secrets\n');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(ROOT, { recursive: true, force: true });
    rmSync(PROJECTS_CONFIG_FILE, { force: true });
    invalidateProjectsConfigCache();
  });

  it('expands ${NAME} from secrets first, then process.env, and leaves $NAME untouched', async () => {
    vi.stubEnv('SHARED', 'from-process-env');
    vi.stubEnv('SENTRY_TOKEN', 'sentry-from-env');
    writeAcme(
      `    mcp_servers:\n` +
        `      - linear:\n          command: npx\n          args: ["-y", "linear-mcp", "--key=\${ACME_LINEAR_KEY}", "$ACME_LINEAR_KEY"]\n` +
        `          env:\n            SHARED: "\${SHARED}"\n` +
        `      - sentry:\n          type: http\n          url: "https://mcp.sentry.dev/\${SENTRY_TOKEN}"\n` +
        `          headers:\n            Authorization: "Bearer \${SENTRY_TOKEN}"\n`,
    );
    const { projectKey, servers, strict, warnings } = await resolve();
    expect(warnings).toEqual([]);
    expect(projectKey).toBe('acme');
    expect(strict).toBe(false);
    expect(servers.linear).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'linear-mcp', '--key=lin-from-secrets', '$ACME_LINEAR_KEY'],
      env: { SHARED: 'from-secrets' },
    });
    expect(servers.sentry).toEqual({
      type: 'http',
      url: 'https://mcp.sentry.dev/sentry-from-env',
      headers: { Authorization: 'Bearer sentry-from-env' },
    });
  });

  it('skips a server with an unresolved reference and names only the variable', async () => {
    writeAcme(
      `    mcp_servers:\n` +
        `      - ok:\n          command: mcp-ok\n          args: ["\${ACME_LINEAR_KEY}"]\n` +
        `      - broken:\n          command: mcp-broken\n          args: ["\${ACME_LINEAR_KEY}", "\${PAN5061_UNSET_VAR}"]\n`,
    );
    const { servers, warnings } = await resolve();
    expect(Object.keys(servers)).toEqual(['ok']);
    expect(warnings).toEqual(['[project-mcp] acme: server broken skipped: ${PAN5061_UNSET_VAR} is not set']);
    expect(warnings.join('\n')).not.toContain('lin-from-secrets');
  });

  it("drops a server that clashes with the launching role's server", async () => {
    writeAcme(`    mcp_servers:\n      - playwright:\n          command: my-playwright\n      - fs:\n          command: mcp-fs\n`);
    const { servers, warnings } = await resolve(['playwright']);
    expect(Object.keys(servers)).toEqual(['fs']);
    expect(warnings).toEqual(['[project-mcp] acme: server playwright skipped: the launching role declares a server with this name']);
  });

  it('reports mcp_strict', async () => {
    writeAcme(`    mcp_strict: true\n    mcp_servers:\n      - fs:\n          command: mcp-fs\n`);
    expect((await resolve()).strict).toBe(true);
    writeAcme(`    mcp_servers:\n      - fs:\n          command: mcp-fs\n`);
    expect((await resolve()).strict).toBe(false);
  });

  it('returns nothing for a launch with no project', async () => {
    writeAcme('');
    const result = await resolveProjectMcpServers({ issueId: 'NOPE-1', cwd: join(ROOT, 'elsewhere'), reservedNames: [] });
    expect(result).toEqual({ projectKey: null, servers: {}, strict: false });
  });
});
