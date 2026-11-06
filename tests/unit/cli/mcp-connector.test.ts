/**
 * PAN-4950 WI-11: `pan mcp connector` registration. The six subcommands, the `--port`, `--wait`
 * and `--platform` checks that run before any connector module loads, and a lazy load that keeps
 * werift out of CLI startup. PAN-5069 A-9 added `connect`.
 */
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  werift: vi.fn(() => ({})),
  serve: vi.fn(() => ({ runConnectorServe: vi.fn(async () => 0) })),
  connect: vi.fn(() => ({ runConnectorConnect: vi.fn(async () => 0) })),
  exitCli: vi.fn(async (code: number) => {
    throw new Error(`exit ${code}`);
  }),
}));

vi.mock('werift', () => mocks.werift());
vi.mock('../../../src/lib/mcp/connector/serve.js', () => mocks.serve());
vi.mock('../../../src/lib/mcp/connector/connect.js', () => mocks.connect());
vi.mock('../../../src/cli/exit.js', () => ({ exitCli: mocks.exitCli }));

const { registerMcpCommands } = await import('../../../src/cli/commands/mcp.js');
const { parseConnectPlatform, parseConnectWait, parseConnectorPort, PLATFORM_MESSAGE, PORT_MESSAGE, WAIT_MESSAGE } = await import(
  '../../../src/cli/commands/mcp-connector.js'
);
const { CONNECT_PLATFORMS } = await import('../../../src/lib/mcp/connector/connect-output.js');

function program(): Command {
  const created = new Command().name('pan').version('9.9.9').exitOverride();
  registerMcpCommands(created);
  return created;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pan mcp connector', () => {
  it('has exactly connect, login, pair, serve, status and logout, and its help lists connect', () => {
    const mcp = program().commands.find((command) => command.name() === 'mcp');
    const connector = mcp?.commands.find((command) => command.name() === 'connector');
    expect(connector?.commands.map((command) => command.name())).toEqual(['connect', 'login', 'pair', 'serve', 'status', 'logout']);
    expect(connector?.helpInformation()).toMatch(/connect \[options\] <pairingString>/);
  });

  it.each([
    [['--wait', 'abc'], WAIT_MESSAGE],
    [['--platform', 'slack'], PLATFORM_MESSAGE],
  ])('connect %j exits 1 before loading connect.js', async (flags, message) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(program().parseAsync(['node', 'pan', 'mcp', 'connector', 'connect', 'overdeck-connector:/pair#v=1', ...flags])).rejects.toThrow('exit 1');
    expect(stderr).toHaveBeenCalledWith(`${message}\n`);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('parses --wait', () => {
    expect(parseConnectWait(undefined)).toBe(120);
    expect(parseConnectWait('0')).toBe(0);
    expect(parseConnectWait('900')).toBe(900);
    expect(parseConnectWait('901')).toBeNull();
    expect(parseConnectWait('-1')).toBeNull();
    expect(parseConnectWait('abc')).toBeNull();
  });

  it('parses --platform with the same list as the connect contract', () => {
    for (const platform of CONNECT_PLATFORMS) expect(parseConnectPlatform(platform)).toBe(platform);
    expect(parseConnectPlatform(undefined)).toBe('other');
    expect(parseConnectPlatform('slack')).toBeNull();
  });

  it.each(['0', '70000', '12ab'])('serve --port %s exits 1 before loading the connector', async (port) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(program().parseAsync(['node', 'pan', 'mcp', 'connector', 'serve', '--port', port])).rejects.toThrow('exit 1');
    expect(stderr).toHaveBeenCalledWith(`${PORT_MESSAGE}\n`);
    expect(mocks.serve).not.toHaveBeenCalled();
  });

  it('parses ports', () => {
    expect(parseConnectorPort(undefined)).toBe(7466);
    expect(parseConnectorPort('8080')).toBe(8080);
    expect(parseConnectorPort('65535')).toBe(65535);
    expect(parseConnectorPort('65536')).toBeNull();
    expect(parseConnectorPort('-1')).toBeNull();
  });

  it('does not load werift when the CLI registers the commands', () => {
    program();
    expect(mocks.werift).not.toHaveBeenCalled();
  });
});
